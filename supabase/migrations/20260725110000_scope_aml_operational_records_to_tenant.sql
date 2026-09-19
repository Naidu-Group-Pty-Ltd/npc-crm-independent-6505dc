-- Security: prevent AML operational records from being visible across tenants.
DROP POLICY IF EXISTS rollout_stage_history_read ON aml.rollout_stage_history;
CREATE POLICY rollout_stage_history_read
  ON aml.rollout_stage_history FOR SELECT TO authenticated
  USING (aml.has_any_tenant_aml_role(auth.uid(), tenant_id));

DROP POLICY IF EXISTS acceptance_scenarios_read ON aml.acceptance_scenarios;
DROP POLICY IF EXISTS acceptance_scenarios_mlro_write ON aml.acceptance_scenarios;
CREATE POLICY acceptance_scenarios_read
  ON aml.acceptance_scenarios FOR SELECT TO authenticated
  USING (aml.has_any_tenant_aml_role(auth.uid(), tenant_id));
CREATE POLICY acceptance_scenarios_mlro_write
  ON aml.acceptance_scenarios FOR ALL TO authenticated
  USING (aml.has_tenant_aml_role(auth.uid(), tenant_id, 'mlro'))
  WITH CHECK (aml.has_tenant_aml_role(auth.uid(), tenant_id, 'mlro'));

DROP POLICY IF EXISTS risk_register_read ON aml.risk_register;
DROP POLICY IF EXISTS risk_register_mlro_write ON aml.risk_register;
CREATE POLICY risk_register_read
  ON aml.risk_register FOR SELECT TO authenticated
  USING (aml.has_any_tenant_aml_role(auth.uid(), tenant_id));
CREATE POLICY risk_register_mlro_write
  ON aml.risk_register FOR ALL TO authenticated
  USING (aml.has_tenant_aml_role(auth.uid(), tenant_id, 'mlro'))
  WITH CHECK (aml.has_tenant_aml_role(auth.uid(), tenant_id, 'mlro'));
