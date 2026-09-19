import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StructuredTerminologyEditor } from "./AmlConfiguration";

function ControlledEditor({ initialValue = "{}" }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);

  return (
    <>
      <StructuredTerminologyEditor
        value={value}
        onChange={setValue}
        lockedKeys={[]}
        disabled={false}
      />
      <output data-testid="serialized-value">{value}</output>
    </>
  );
}

describe("StructuredTerminologyEditor", () => {
  it("keeps a new blank override visible until it can be completed", () => {
    render(<ControlledEditor />);

    fireEvent.click(screen.getByRole("button", { name: "Add override" }));

    const keyInput = screen.getByPlaceholderText("e.g. Customer Compliance");
    const replacementInput = screen.getByPlaceholderText("e.g. Client KYC");
    expect(keyInput).toHaveValue("");
    expect(replacementInput).toHaveValue("");

    fireEvent.change(replacementInput, { target: { value: "Client Review" } });
    fireEvent.change(keyInput, { target: { value: "Customer Compliance" } });

    // Compare parsed JSON rather than text: toHaveTextContent collapses the
    // element's whitespace, so a pretty-printed expected string never matches.
    expect(
      JSON.parse(screen.getByTestId("serialized-value").textContent ?? "{}"),
    ).toEqual({ "Customer Compliance": "Client Review" });
  });

  it("appends a blank override after an existing override", () => {
    render(<ControlledEditor initialValue={JSON.stringify({ Existing: "Replacement" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Add override" }));

    expect(screen.getAllByPlaceholderText("e.g. Customer Compliance")).toHaveLength(2);
    expect(screen.getAllByPlaceholderText("e.g. Client KYC")).toHaveLength(2);
  });
});
