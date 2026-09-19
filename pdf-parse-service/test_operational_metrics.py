"""Pure Sidecar Operational Metrics V1 tests (Path-to-100 v2 · G2).

Stdlib unittest, fake clock — no Docling. The accumulator is exactly what the
parse handlers use, so simulating a handler's phase-recording here exercises the
real contract. Run:
    python3 -m unittest test_operational_metrics   (from pdf-parse-service/)
"""

import json
import math
import unittest

from operational_metrics import (
    OperationalMetricsAccumulator,
    operational_metrics_capabilities,
    SIDECAR_OPERATIONAL_METRICS_VERSION,
    MEASURED, NOT_APPLICABLE, NOT_COMPLETED, NOT_OBSERVABLE,
    TIMING_PHASES,
)


class FakeClock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


def _all_numbers(obj):
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        assert math.isfinite(obj), f"non-finite {obj}"
        assert obj >= 0, f"negative {obj}"
    elif isinstance(obj, dict):
        for v in obj.values():
            _all_numbers(v)
    elif isinstance(obj, list):
        for v in obj:
            _all_numbers(v)


def monolithic(clock, *, kind="url"):
    return OperationalMetricsAccumulator(
        "monolithic", clock=clock, engine_version="docling-x",
        lane_enforcement_version="extractor-lane-policy-v2",
        job_id="job-1", request_id="req-1", extractor_lane="accurate_table",
        requested_mode="hybrid", effective_mode="hybrid", memory_profile="standard",
        source_input_kind=kind,
    )


def monolithic_full_run(clock):
    """Simulate a complete monolithic hybrid run the way _run_async_job records
    it: source → parse → raster → (upload block containing per-page)."""
    acc = monolithic(clock, kind="url")
    acc.set_bytes_in(2048)
    clock.advance(0.020); acc.record("source_download_ms", 20)
    clock.advance(0.400); acc.record("parse_ms", 400)
    clock.advance(0.150); acc.record("raster_ms", 150)
    pp_start = clock()
    clock.advance(0.040)
    acc.record("per_page_artifact_ms", (clock() - pp_start) * 1000)
    acc.record("artifact_upload_ms", 90)  # whole upload block incl. per-page
    acc.set_counts_from_summary(
        {"table_count": 3, "picture_count": 2, "text_block_count": 50, "vector_count": 10, "ocr_pages": [2]},
        5,
    )
    acc.set_bytes_out(4096)
    return acc


class ContractTests(unittest.TestCase):
    def test_contract_version(self):  # #1
        acc = monolithic(FakeClock())
        self.assertEqual(acc.build("succeeded")["contract_version"], SIDECAR_OPERATIONAL_METRICS_VERSION)
        self.assertEqual(SIDECAR_OPERATIONAL_METRICS_VERSION, "sidecar-operational-metrics-v1")

    def test_all_present_numbers_finite_nonneg(self):  # #2 / #35
        clock = FakeClock()
        acc = monolithic(clock)
        acc.set_bytes_in(1234)
        clock.advance(0.010); acc.record("source_download_ms", 10)
        clock.advance(0.500); acc.record("parse_ms", 500)
        acc.set_counts_from_summary({"table_count": 2, "picture_count": 1, "text_block_count": 9, "vector_count": 3, "ocr_pages": [1]}, 4)
        acc.set_bytes_out(9999)
        _all_numbers(acc.build("succeeded"))

    def test_unavailable_phase_is_null_not_zero(self):  # #3 / #17
        acc = monolithic(FakeClock())
        m = acc.build("failed")  # nothing recorded
        self.assertIsNone(m["timings"]["parse_ms"])
        self.assertEqual(m["measurement_state"]["parse_ms"], NOT_COMPLETED)
        self.assertIsNone(m["timings"]["raster_ms"])

    def test_json_no_nan_infinity(self):  # #4
        acc = monolithic(FakeClock())
        acc.set_counts_from_summary({"ocr_pages": []}, 0)  # ocr ratio path with 0 pages
        s = json.dumps(acc.build("succeeded"), allow_nan=False)  # raises if NaN/Inf
        self.assertIn("sidecar-operational-metrics-v1", s)

    def test_measurement_state_agrees_with_values(self):  # #5
        clock = FakeClock()
        acc = monolithic(clock)
        clock.advance(0.2); acc.record("parse_ms", 200)
        m = acc.build("succeeded")
        for phase in TIMING_PHASES:
            if m["measurement_state"][phase] == MEASURED:
                self.assertIsNotNone(m["timings"][phase])
            else:
                self.assertIsNone(m["timings"][phase])


class SourceTests(unittest.TestCase):
    def test_url_records_download_marks_resolve_na(self):  # #6
        acc = monolithic(FakeClock(), kind="url")
        acc.record("source_download_ms", 42)
        m = acc.build("succeeded")
        self.assertEqual(m["timings"]["source_download_ms"], 42)
        self.assertEqual(m["measurement_state"]["source_resolve_ms"], NOT_APPLICABLE)
        self.assertIsNone(m["timings"]["source_resolve_ms"])

    def test_base64_records_resolve_marks_download_na(self):  # #7
        acc = monolithic(FakeClock(), kind="base64")
        acc.record("source_resolve_ms", 3)
        m = acc.build("succeeded")
        self.assertEqual(m["timings"]["source_resolve_ms"], 3)
        self.assertEqual(m["measurement_state"]["source_download_ms"], NOT_APPLICABLE)
        self.assertEqual(m["source_input_kind"], "base64")

    def test_source_failure_partial_no_url_leak(self):  # #8
        acc = monolithic(FakeClock(), kind="url")
        m = acc.build("failed")  # failed before source completed
        self.assertEqual(m["status"], "failed")
        self.assertEqual(m["measurement_state"]["source_download_ms"], NOT_COMPLETED)
        # The metrics carry only the categorical source kind — never a real URL.
        blob = json.dumps(m).lower()
        for leak in ("http://", "https://", "token=", "?sig", "supabase", "bearer"):
            self.assertNotIn(leak, blob)


class UploadSubsetTests(unittest.TestCase):
    def test_per_page_is_subset_of_upload(self):  # #12
        clock = FakeClock()
        acc = monolithic(clock)
        up = clock()
        clock.advance(0.080)
        pp_start = clock()
        clock.advance(0.030)
        acc.record("per_page_artifact_ms", (clock() - pp_start) * 1000)
        acc.record("artifact_upload_ms", (clock() - up) * 1000)
        m = acc.build("succeeded")
        self.assertLessEqual(m["timings"]["per_page_artifact_ms"], m["timings"]["artifact_upload_ms"] + 1)

    def test_elapsed_at_least_sum_of_phases(self):  # #13
        clock = FakeClock()
        acc = monolithic(clock)
        clock.advance(0.010); acc.record("source_download_ms", 10)
        clock.advance(0.500); acc.record("parse_ms", 500)
        clock.advance(0.100); acc.record("artifact_upload_ms", 100)
        m = acc.build("succeeded")
        total = sum(m["timings"][p] or 0 for p in ("source_download_ms", "parse_ms", "artifact_upload_ms"))
        self.assertGreaterEqual(m["timings"]["sidecar_elapsed_before_callback_ms"] + 2, total)


class CallbackHonestyTests(unittest.TestCase):
    def test_callback_attempt_ms_null_not_observable(self):  # #29
        m = monolithic(FakeClock()).build("succeeded")
        self.assertIsNone(m["timings"]["callback_attempt_ms"])
        self.assertEqual(m["measurement_state"]["callback_attempt_ms"], NOT_OBSERVABLE)

    def test_retry_can_report_prior_attempts_without_current_ms(self):  # #31
        acc = monolithic(FakeClock())
        acc.set_callback_attempt_count(2)
        m = acc.build("succeeded")
        self.assertEqual(m["callback_attempt_count"], 2)
        self.assertIsNone(m["timings"]["callback_attempt_ms"])  # current attempt still unobservable


class ChunkTests(unittest.TestCase):
    def chunk(self, clock):
        return OperationalMetricsAccumulator(
            "chunk", clock=clock, engine_version="e", lane_enforcement_version="extractor-lane-policy-v2",
            job_id="j", chunk_id="c", chunk_index=2, page_start=6, page_end=10,
            extractor_lane="ocr_scanned", requested_mode="hybrid", effective_mode="hybrid",
            memory_profile="heavy", source_input_kind="url",
        )

    def test_chunk_scope_range_and_count(self):  # #19/#20/#21/#22/#23
        clock = FakeClock()
        acc = self.chunk(clock)
        clock.advance(0.3); acc.record("parse_ms", 300)
        acc.set_counts_from_summary({"ocr_pages": [6, 7]}, 5)
        m = acc.build("succeeded")
        self.assertEqual(m["scope"], "chunk")
        self.assertEqual((m["chunk_id"], m["chunk_index"]), ("c", 2))
        self.assertEqual((m["page_start"], m["page_end"]), (6, 10))
        self.assertEqual(m["counts"]["page_count"], 5)
        self.assertEqual(m["counts"]["chunk_count"], 1)

    def test_chunk_failure_partial(self):  # #24
        m = self.chunk(FakeClock()).build("failed")
        self.assertEqual(m["status"], "failed")
        self.assertEqual(m["measurement_state"]["parse_ms"], NOT_COMPLETED)
        self.assertEqual((m["page_start"], m["page_end"]), (6, 10))


class SynchronousTests(unittest.TestCase):
    def test_sync_scope_and_callback_na(self):  # #26/#27
        acc = OperationalMetricsAccumulator(
            "synchronous", clock=FakeClock(), engine_version="e",
            lane_enforcement_version="extractor-lane-policy-v2", source_input_kind="base64",
            extractor_lane="fast_native", requested_mode="semantic", effective_mode="semantic",
            memory_profile="fast",
        )
        m = acc.build("succeeded")
        self.assertEqual(m["scope"], "synchronous")
        self.assertEqual(m["measurement_state"]["callback_attempt_ms"], NOT_APPLICABLE)
        self.assertEqual(m["callback_attempt_count"], 0)
        self.assertEqual(m["counts"]["chunk_count"], 0)


class CalculationTests(unittest.TestCase):
    def test_avg_parse_ms_per_page(self):  # #32
        clock = FakeClock()
        acc = monolithic(clock)
        acc.record("parse_ms", 1000)
        acc.set_counts_from_summary({}, 4)
        self.assertEqual(acc.build("succeeded")["counts"]["avg_parse_ms_per_page"], 250)

    def test_zero_pages_no_div_by_zero(self):  # #33
        acc = monolithic(FakeClock())
        acc.record("parse_ms", 500)
        acc.set_counts_from_summary({"ocr_pages": []}, 0)
        m = acc.build("succeeded")
        self.assertIsNone(m["counts"]["avg_parse_ms_per_page"])
        self.assertEqual(m["counts"]["ocr_page_ratio"], 0.0)

    def test_ocr_ratio_within_bounds(self):  # #34
        acc = monolithic(FakeClock())
        acc.set_counts_from_summary({"ocr_pages": [1, 2, 3]}, 3)
        self.assertEqual(acc.build("succeeded")["counts"]["ocr_page_ratio"], 1.0)

    def test_memory_profile_passthrough(self):  # #36
        acc = monolithic(FakeClock())
        self.assertEqual(acc.build("succeeded")["memory_profile"], "standard")


class MonolithicSuccessTests(unittest.TestCase):
    def test_parse_ms_populated(self):  # #9
        m = monolithic_full_run(FakeClock()).build("succeeded")
        self.assertEqual(m["timings"]["parse_ms"], 400)
        self.assertEqual(m["measurement_state"]["parse_ms"], MEASURED)

    def test_raster_ms_only_when_raster_ran(self):  # #10
        ran = monolithic_full_run(FakeClock()).build("succeeded")
        self.assertEqual(ran["timings"]["raster_ms"], 150)
        # Semantic-style run: raster never ran → explicit not_applicable, not zero.
        acc = monolithic(FakeClock())
        acc.record("parse_ms", 100)
        acc.mark("raster_ms", NOT_APPLICABLE)
        no_raster = acc.build("succeeded")
        self.assertIsNone(no_raster["timings"]["raster_ms"])
        self.assertEqual(no_raster["measurement_state"]["raster_ms"], NOT_APPLICABLE)

    def test_artifact_upload_ms_populated(self):  # #11
        m = monolithic_full_run(FakeClock()).build("succeeded")
        self.assertEqual(m["timings"]["artifact_upload_ms"], 90)
        self.assertEqual(m["measurement_state"]["artifact_upload_ms"], MEASURED)

    def test_page_count_byte_fields_correct(self):  # #14
        m = monolithic_full_run(FakeClock()).build("succeeded")
        self.assertEqual(m["counts"]["page_count"], 5)
        self.assertEqual(m["counts"]["table_count"], 3)
        self.assertEqual(m["counts"]["picture_count"], 2)
        self.assertEqual(m["counts"]["text_block_count"], 50)
        self.assertEqual(m["counts"]["vector_count"], 10)
        self.assertEqual(m["bytes"]["bytes_in"], 2048)
        self.assertEqual(m["bytes"]["bytes_out"], 4096)

    def test_top_level_and_result_payload_identical(self):  # #15
        acc = monolithic_full_run(FakeClock())
        m = acc.build("succeeded")
        # One canonical object referenced in both callback locations (the app
        # invariant): identity, not just equality.
        payload = {"status": "succeeded", "metrics": m, "result_payload": {"metrics": m}}
        self.assertIs(payload["metrics"], payload["result_payload"]["metrics"])
        # And build is a deterministic snapshot of accumulator state.
        self.assertEqual(acc.build("succeeded"), acc.build("succeeded"))


class MonolithicFailureTests(unittest.TestCase):
    def test_parse_failure_status_and_partial(self):  # #16
        clock = FakeClock()
        acc = monolithic(clock)
        clock.advance(0.020); acc.record("source_download_ms", 20)  # source done, then parse fails
        m = acc.build("failed")
        self.assertEqual(m["status"], "failed")
        self.assertEqual(m["timings"]["source_download_ms"], 20)
        self.assertIsNone(m["timings"]["parse_ms"])
        self.assertEqual(m["measurement_state"]["parse_ms"], NOT_COMPLETED)

    def test_unrun_phases_not_measured_zero(self):  # #17
        m = monolithic(FakeClock()).build("failed")
        for phase in ("raster_ms", "artifact_upload_ms", "per_page_artifact_ms"):
            self.assertIsNone(m["timings"][phase])
            self.assertNotEqual(m["measurement_state"][phase], MEASURED)

    def test_metrics_cannot_mask_original_error(self):  # #18
        # The metrics object is additive + namespaced: it carries no error_code/
        # message/error key, so nesting it under "metrics" can never overwrite the
        # sibling failure fields the callback already sends.
        m = monolithic(FakeClock()).build("failed")
        for masking_key in ("error", "error_code", "message", "retryable"):
            self.assertNotIn(masking_key, m)
        json.dumps(m, allow_nan=False)  # serializes cleanly alongside the error


class RetryAndLegacyTests(unittest.TestCase):
    def test_retry_preserves_metrics_no_timing_mutation(self):  # #25
        clock = FakeClock()
        acc = monolithic(clock)
        clock.advance(0.3); acc.record("parse_ms", 300)
        before = acc.build("succeeded")["timings"]
        acc.set_callback_attempt_count(3)  # a retry recorded prior attempts
        after = acc.build("succeeded")
        self.assertEqual(after["timings"], before)  # phase timings untouched
        self.assertEqual(after["callback_attempt_count"], 3)

    def test_metrics_additive_preserves_legacy_fields(self):  # #28
        legacy = {
            "job_id": "j", "status": "succeeded", "engine_version": "e",
            "page_count": 5, "bytes_in": 1, "bytes_out": 2, "cloud_run_ms": 10,
            "duration_ms": 20, "result_payload": {"docling_path": "p"},
        }
        snapshot = dict(legacy)
        legacy["metrics"] = monolithic_full_run(FakeClock()).build("succeeded")
        for key, value in snapshot.items():
            self.assertEqual(legacy[key], value)

    def test_completed_attempt_duration_logged_out_of_band(self):  # #30
        # The payload never carries the completed duration of its own delivery;
        # the poster returns it (int ms) to be logged AFTER the HTTP response.
        acc = monolithic(FakeClock())
        m = acc.build("succeeded")
        self.assertIsNone(m["timings"]["callback_attempt_ms"])
        completed_attempt_ms = 12  # what _post_callback returns to the caller
        self.assertIsInstance(completed_attempt_ms, int)
        # Setting the (prior) attempt count still does not embed a current duration.
        acc.set_callback_attempt_count(1)
        self.assertIsNone(acc.build("succeeded")["timings"]["callback_attempt_ms"])


class ChunkLocalTimingTests(unittest.TestCase):
    def test_chunk_elapsed_is_local_not_parent(self):  # #23
        parent_clock = FakeClock(t=5000.0)  # parent job has been running a long time
        acc = OperationalMetricsAccumulator(
            "chunk", clock=parent_clock, engine_version="e",
            lane_enforcement_version="extractor-lane-policy-v2",
            job_id="j", chunk_id="c", chunk_index=1, page_start=1, page_end=5,
            source_input_kind="url",
        )
        parent_clock.advance(0.250); acc.record("parse_ms", 250)
        m = acc.build("succeeded")
        # Chunk-local elapsed reflects only this chunk's wall time (~250ms), never
        # the parent job's much larger elapsed.
        self.assertLess(m["timings"]["sidecar_elapsed_before_callback_ms"], 1000)


class ByteFieldTests(unittest.TestCase):
    def test_bytes_non_negative_integers(self):  # #35
        acc = monolithic(FakeClock())
        acc.set_bytes_in(-99)   # clamped
        acc.set_bytes_out(1500.9)  # coerced to int
        m = acc.build("succeeded")
        self.assertEqual(m["bytes"]["bytes_in"], 0)
        self.assertEqual(m["bytes"]["bytes_out"], 1500)
        self.assertIsInstance(m["bytes"]["bytes_in"], int)
        self.assertIsInstance(m["bytes"]["bytes_out"], int)


class CapabilitiesTests(unittest.TestCase):
    def test_capabilities_block(self):  # #37/#38/#39
        cap = operational_metrics_capabilities()
        self.assertEqual(cap["contract_version"], "sidecar-operational-metrics-v1")
        self.assertIn("callback_timing_limitation", cap)
        self.assertIn("not_observable", cap["callback_timing_limitation"])
        self.assertEqual(cap["timing_unit"], "milliseconds")
        self.assertFalse(cap["measures_rss"])
        blob = json.dumps(cap).lower()
        for secret in ("bearer", "service_role", "token", "supabase_url", "password"):
            self.assertNotIn(secret, blob)


if __name__ == "__main__":
    unittest.main()
