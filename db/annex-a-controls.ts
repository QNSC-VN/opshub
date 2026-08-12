/**
 * ISO/IEC 27001:2022 Annex A — the catalogue every Statement of Applicability is measured against.
 *
 * 93 controls: 37 organizational, 8 people, 14 physical, 34 technological.
 *
 * ONLY THE CLAUSE NUMBER AND SHORT TITLE. The standard's own control text is copyrighted and is not
 * reproduced here. `description` is left unset on purpose: what belongs there is how THIS organisation
 * implements the control, and that is the SoA entry's `implementation_note`.
 *
 * Titles are transcribed from the 2022 edition and should be diffed against a licensed copy before an
 * audit. A wrong title is a cosmetic defect; an empty catalogue makes the module unusable, which is what
 * this replaced.
 */
export const ANNEX_A_CONTROLS: Array<{
  reference: string;
  title: string;
  theme: 'organizational' | 'people' | 'physical' | 'technological';
}> = [
  { reference: 'A.5.1', title: 'Policies for information security', theme: 'organizational' },
  {
    reference: 'A.5.2',
    title: 'Information security roles and responsibilities',
    theme: 'organizational',
  },
  { reference: 'A.5.3', title: 'Segregation of duties', theme: 'organizational' },
  { reference: 'A.5.4', title: 'Management responsibilities', theme: 'organizational' },
  { reference: 'A.5.5', title: 'Contact with authorities', theme: 'organizational' },
  { reference: 'A.5.6', title: 'Contact with special interest groups', theme: 'organizational' },
  { reference: 'A.5.7', title: 'Threat intelligence', theme: 'organizational' },
  {
    reference: 'A.5.8',
    title: 'Information security in project management',
    theme: 'organizational',
  },
  {
    reference: 'A.5.9',
    title: 'Inventory of information and other associated assets',
    theme: 'organizational',
  },
  {
    reference: 'A.5.10',
    title: 'Acceptable use of information and other associated assets',
    theme: 'organizational',
  },
  { reference: 'A.5.11', title: 'Return of assets', theme: 'organizational' },
  { reference: 'A.5.12', title: 'Classification of information', theme: 'organizational' },
  { reference: 'A.5.13', title: 'Labelling of information', theme: 'organizational' },
  { reference: 'A.5.14', title: 'Information transfer', theme: 'organizational' },
  { reference: 'A.5.15', title: 'Access control', theme: 'organizational' },
  { reference: 'A.5.16', title: 'Identity management', theme: 'organizational' },
  { reference: 'A.5.17', title: 'Authentication information', theme: 'organizational' },
  { reference: 'A.5.18', title: 'Access rights', theme: 'organizational' },
  {
    reference: 'A.5.19',
    title: 'Information security in supplier relationships',
    theme: 'organizational',
  },
  {
    reference: 'A.5.20',
    title: 'Addressing information security within supplier agreements',
    theme: 'organizational',
  },
  {
    reference: 'A.5.21',
    title: 'Managing information security in the ICT supply chain',
    theme: 'organizational',
  },
  {
    reference: 'A.5.22',
    title: 'Monitoring, review and change management of supplier services',
    theme: 'organizational',
  },
  {
    reference: 'A.5.23',
    title: 'Information security for use of cloud services',
    theme: 'organizational',
  },
  {
    reference: 'A.5.24',
    title: 'Information security incident management planning and preparation',
    theme: 'organizational',
  },
  {
    reference: 'A.5.25',
    title: 'Assessment and decision on information security events',
    theme: 'organizational',
  },
  {
    reference: 'A.5.26',
    title: 'Response to information security incidents',
    theme: 'organizational',
  },
  {
    reference: 'A.5.27',
    title: 'Learning from information security incidents',
    theme: 'organizational',
  },
  { reference: 'A.5.28', title: 'Collection of evidence', theme: 'organizational' },
  { reference: 'A.5.29', title: 'Information security during disruption', theme: 'organizational' },
  { reference: 'A.5.30', title: 'ICT readiness for business continuity', theme: 'organizational' },
  {
    reference: 'A.5.31',
    title: 'Legal, statutory, regulatory and contractual requirements',
    theme: 'organizational',
  },
  { reference: 'A.5.32', title: 'Intellectual property rights', theme: 'organizational' },
  { reference: 'A.5.33', title: 'Protection of records', theme: 'organizational' },
  {
    reference: 'A.5.34',
    title: 'Privacy and protection of personal identifiable information',
    theme: 'organizational',
  },
  {
    reference: 'A.5.35',
    title: 'Independent review of information security',
    theme: 'organizational',
  },
  {
    reference: 'A.5.36',
    title: 'Compliance with policies, rules and standards for information security',
    theme: 'organizational',
  },
  { reference: 'A.5.37', title: 'Documented operating procedures', theme: 'organizational' },
  { reference: 'A.6.1', title: 'Screening', theme: 'people' },
  { reference: 'A.6.2', title: 'Terms and conditions of employment', theme: 'people' },
  {
    reference: 'A.6.3',
    title: 'Information security awareness, education and training',
    theme: 'people',
  },
  { reference: 'A.6.4', title: 'Disciplinary process', theme: 'people' },
  {
    reference: 'A.6.5',
    title: 'Responsibilities after termination or change of employment',
    theme: 'people',
  },
  { reference: 'A.6.6', title: 'Confidentiality or non-disclosure agreements', theme: 'people' },
  { reference: 'A.6.7', title: 'Remote working', theme: 'people' },
  { reference: 'A.6.8', title: 'Information security event reporting', theme: 'people' },
  { reference: 'A.7.1', title: 'Physical security perimeters', theme: 'physical' },
  { reference: 'A.7.2', title: 'Physical entry', theme: 'physical' },
  { reference: 'A.7.3', title: 'Securing offices, rooms and facilities', theme: 'physical' },
  { reference: 'A.7.4', title: 'Physical security monitoring', theme: 'physical' },
  {
    reference: 'A.7.5',
    title: 'Protecting against physical and environmental threats',
    theme: 'physical',
  },
  { reference: 'A.7.6', title: 'Working in secure areas', theme: 'physical' },
  { reference: 'A.7.7', title: 'Clear desk and clear screen', theme: 'physical' },
  { reference: 'A.7.8', title: 'Equipment siting and protection', theme: 'physical' },
  { reference: 'A.7.9', title: 'Security of assets off-premises', theme: 'physical' },
  { reference: 'A.7.10', title: 'Storage media', theme: 'physical' },
  { reference: 'A.7.11', title: 'Supporting utilities', theme: 'physical' },
  { reference: 'A.7.12', title: 'Cabling security', theme: 'physical' },
  { reference: 'A.7.13', title: 'Equipment maintenance', theme: 'physical' },
  { reference: 'A.7.14', title: 'Secure disposal or re-use of equipment', theme: 'physical' },
  { reference: 'A.8.1', title: 'User end point devices', theme: 'technological' },
  { reference: 'A.8.2', title: 'Privileged access rights', theme: 'technological' },
  { reference: 'A.8.3', title: 'Information access restriction', theme: 'technological' },
  { reference: 'A.8.4', title: 'Access to source code', theme: 'technological' },
  { reference: 'A.8.5', title: 'Secure authentication', theme: 'technological' },
  { reference: 'A.8.6', title: 'Capacity management', theme: 'technological' },
  { reference: 'A.8.7', title: 'Protection against malware', theme: 'technological' },
  { reference: 'A.8.8', title: 'Management of technical vulnerabilities', theme: 'technological' },
  { reference: 'A.8.9', title: 'Configuration management', theme: 'technological' },
  { reference: 'A.8.10', title: 'Information deletion', theme: 'technological' },
  { reference: 'A.8.11', title: 'Data masking', theme: 'technological' },
  { reference: 'A.8.12', title: 'Data leakage prevention', theme: 'technological' },
  { reference: 'A.8.13', title: 'Information backup', theme: 'technological' },
  {
    reference: 'A.8.14',
    title: 'Redundancy of information processing facilities',
    theme: 'technological',
  },
  { reference: 'A.8.15', title: 'Logging', theme: 'technological' },
  { reference: 'A.8.16', title: 'Monitoring activities', theme: 'technological' },
  { reference: 'A.8.17', title: 'Clock synchronization', theme: 'technological' },
  { reference: 'A.8.18', title: 'Use of privileged utility programs', theme: 'technological' },
  {
    reference: 'A.8.19',
    title: 'Installation of software on operational systems',
    theme: 'technological',
  },
  { reference: 'A.8.20', title: 'Networks security', theme: 'technological' },
  { reference: 'A.8.21', title: 'Security of network services', theme: 'technological' },
  { reference: 'A.8.22', title: 'Segregation of networks', theme: 'technological' },
  { reference: 'A.8.23', title: 'Web filtering', theme: 'technological' },
  { reference: 'A.8.24', title: 'Use of cryptography', theme: 'technological' },
  { reference: 'A.8.25', title: 'Secure development life cycle', theme: 'technological' },
  { reference: 'A.8.26', title: 'Application security requirements', theme: 'technological' },
  {
    reference: 'A.8.27',
    title: 'Secure system architecture and engineering principles',
    theme: 'technological',
  },
  { reference: 'A.8.28', title: 'Secure coding', theme: 'technological' },
  {
    reference: 'A.8.29',
    title: 'Security testing in development and acceptance',
    theme: 'technological',
  },
  { reference: 'A.8.30', title: 'Outsourced development', theme: 'technological' },
  {
    reference: 'A.8.31',
    title: 'Separation of development, test and production environments',
    theme: 'technological',
  },
  { reference: 'A.8.32', title: 'Change management', theme: 'technological' },
  { reference: 'A.8.33', title: 'Test information', theme: 'technological' },
  {
    reference: 'A.8.34',
    title: 'Protection of information systems during audit testing',
    theme: 'technological',
  },
];
