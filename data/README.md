# Fictional input data

All companies and contacts are fictional test cases. The authoritative fixture is `../demo_fixture.json`; matching JSON arrays are embedded in the Setup workflow.

Setup execution 93 seeded n8n Data Tables directly from that JSON. No CSV file was manually imported. The Excel and CSV files in this folder were exported later to make the same inputs easy to inspect. They are not live CRM exports or AI-generated output records. Blank cells preserve missing source values.

The Excel workbook has Chinese and original field labels, with separate CRM and delivery sheets. The common account ID and assessment date join the two datasets. Assessment date is fixed at 2026-08-31.
