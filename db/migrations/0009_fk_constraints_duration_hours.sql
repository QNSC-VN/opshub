-- Fix duration_hours column type: varchar → integer
ALTER TABLE access.access_requests
  ALTER COLUMN duration_hours TYPE integer USING duration_hours::integer;

-- FK: identity.refresh_tokens → identity.employees
ALTER TABLE identity.refresh_tokens
  ADD CONSTRAINT fk_refresh_token_employee
  FOREIGN KEY (employee_id) REFERENCES identity.employees(id) ON DELETE CASCADE;

-- FK: access.access_grants → access.access_requests
ALTER TABLE access.access_grants
  ADD CONSTRAINT fk_access_grant_request
  FOREIGN KEY (request_id) REFERENCES access.access_requests(id) ON DELETE CASCADE;

-- FK: assets.asset_assignments → assets.assets
ALTER TABLE assets.asset_assignments
  ADD CONSTRAINT fk_assignment_asset
  FOREIGN KEY (asset_id) REFERENCES assets.assets(id) ON DELETE CASCADE;

-- FK: assets.asset_assignments → identity.employees
ALTER TABLE assets.asset_assignments
  ADD CONSTRAINT fk_assignment_employee
  FOREIGN KEY (employee_id) REFERENCES identity.employees(id) ON DELETE RESTRICT;

-- FK: workforce.timesheets → identity.employees
ALTER TABLE workforce.timesheets
  ADD CONSTRAINT fk_timesheet_employee
  FOREIGN KEY (employee_id) REFERENCES identity.employees(id) ON DELETE CASCADE;

-- FK: workforce.leave_requests → identity.employees
ALTER TABLE workforce.leave_requests
  ADD CONSTRAINT fk_leave_employee
  FOREIGN KEY (employee_id) REFERENCES identity.employees(id) ON DELETE CASCADE;

-- FK: workforce.overtime_entries → identity.employees
ALTER TABLE workforce.overtime_entries
  ADD CONSTRAINT fk_overtime_employee
  FOREIGN KEY (employee_id) REFERENCES identity.employees(id) ON DELETE CASCADE;

-- FK: workforce.shift_logs → identity.employees
ALTER TABLE workforce.shift_logs
  ADD CONSTRAINT fk_shift_employee
  FOREIGN KEY (employee_id) REFERENCES identity.employees(id) ON DELETE CASCADE;

-- FK: licenses.license_assignments → licenses.software_licenses
ALTER TABLE licenses.license_assignments
  ADD CONSTRAINT fk_la_license
  FOREIGN KEY (license_id) REFERENCES licenses.software_licenses(id) ON DELETE CASCADE;

-- FK: licenses.license_assignments → identity.employees
ALTER TABLE licenses.license_assignments
  ADD CONSTRAINT fk_la_employee
  FOREIGN KEY (employee_id) REFERENCES identity.employees(id) ON DELETE RESTRICT;

-- FK: compliance.compliance_findings → assets.assets (nullable)
ALTER TABLE compliance.compliance_findings
  ADD CONSTRAINT fk_finding_asset
  FOREIGN KEY (asset_id) REFERENCES assets.assets(id) ON DELETE SET NULL;

-- FK: compliance.compliance_findings → identity.employees (nullable)
ALTER TABLE compliance.compliance_findings
  ADD CONSTRAINT fk_finding_employee
  FOREIGN KEY (employee_id) REFERENCES identity.employees(id) ON DELETE SET NULL;
