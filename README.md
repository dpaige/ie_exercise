# ie_exercise
Integration Engineer Technical Skills Exercise

**Summary**
>A Redox customer needs to send in a bill for service for a procedure performed on behalf of their healthcare organization customer. The first health system the Redox customer is connecting to uses athenahealth, and we need to use the athenahealth API to accomplish the workflow requirements.

**Redox Data Model**

https://developer.redoxengine.com/data-models/Financial.html

**athenahealth APIs**
- POST: https://api.preview.platform.athenahealth.com/oauth2/v1/token
  - Documentation: https://docs.athenahealth.com/api/guides/authentication-and-url-locations
- GET: https://api.preview.platform.athenahealth.com/v1/195900/appointments/[appointmentId]
  - Documentation: https://docs.athenahealth.com/api/api-ref/appointment#Get-appointment-details  
- GET: https://api.preview.platform.athenahealth.com/v1/195900/encounter/[appointmentId]/procedurecodes
  - Documentation: https://docs.athenahealth.com/api/api-ref/procedure-codes#Get-list-of-procedure-codes-available-for-given-encounter 
- POST: https://api.preview.platform.athenahealth.com/v1/195900/encounter/[appointmentId]/services
  - Documentation: https://docs.athenahealth.com/api/api-ref/encounter-services#Create-a-new-service-attacted-to-the-billing-slip-of-an-encounter.

**Details**

This is a simple Node.js app, using Express and Node Fetch to perform relevant HTTP requests.

General steps:
- Redox Financial Transaction payload JSON will be analyzed to make sure it's valid JSON and that it has appropriate data blocks ("Patient", "Visit", "Transactions")
- `configs.json` file read into memory (file path hard-coded in prototype) - contains configuration data, such as athenahealth base URL and authentication Client ID and Secret
- Get Patient MRN and Appointment ID from JSON payload
- Get athenahealth auth token - using Client ID and Secret (in `configs.json`). **Client ID and Secret are obscured in GitHub**
- Get Appointment resource from athenahealth - this will contain the associated Encounter ID and validate that Patient and Appointment from Redox Financial Transaction payload match Appointment resource from athenahealth
- Get allowed Procedure Codes for Appointment from athenahealth and validate that new CPT code will be allowed
- Post (upload) bill to athenahealth Encounter ("Create a new service attached to the billing slip of an encounter")

**Instructions**
- Start the server by entering: `node app.js`
- Send a POST request to: `http://localhost:3000/transaction`, with a Financial JSON payload as the body. See See /sample_data/sample_transaction.json for example JSON input
