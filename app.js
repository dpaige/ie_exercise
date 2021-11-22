const fs = require("fs");
const path = require("path");
const express = require("express");
const fetch = require("node-fetch");
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true })); //for parsing application/x-www-form-urlencoded

app.post("/transaction", async (req, res) => {
  try {
    const body = req.body;

    //only continue if request is JSON and if required JSON blocks are included
    if (!Object.keys(body).length) {
      sendHttpStatus(res, 400, "No valid JSON in HTTP request.");
      return;
    }
    const financialErrorString = "Financial transaction missing required data:";
    const patient = body.Patient;
    if (!Object.keys(patient).length) {
      sendHttpStatus(res, 400, `${financialErrorString} Patient`);
      return;
    }
    const appointment = body.Visit;
    if (!Object.keys(appointment).length) {
      sendHttpStatus(res, 400, `${financialErrorString} Visit`);
      return;
    }
    const transactions = body.Transactions;
    if (!Object.keys(transactions).length || !Array.isArray(transactions)) {
      sendHttpStatus(res, 400, `${financialErrorString} Transactions`);
      return;
    }

    //get configuration file and convert to JSON
    const configs = fs.readFileSync(
      path.resolve("/Users/davepaige/dev/redox_exercise", "configs.json"),
      "utf8",
      (err, data) => {
        if (err) {
          console.log(`Error: ${err}`);
          return;
        }
      }
    );
    if (!configs) {
      //configs is a string
      sendHttpStatus(res, 404, "Missing configs.json file");
      return;
    }
    const configsJson = JSON.parse(configs); //configs is a string - turn to JSON object
    if (!Object.keys(configsJson).length) {
      sendHttpStatus(res, 404, "Configs format not JSON");
      return;
    }

    //get patient MRN and Appointment ID from request JSON blocks
    const mrn = getPatientMrn(patient, configsJson.idType);
    if (!mrn) {
      sendHttpStatus(res, 404, "No MRN found for patient");
      return;
    }
    const apptId = getAppointmentId(appointment);
    if (!apptId) {
      sendHttpStatus(res, 404, "No Appointment ID found");
      return;
    }

    //get auth token via EHR authorization endpoint - use client ID and secret (base64 encoded)
    const auth = await getAuth(configsJson);
    if (!auth || !auth.access_token) {
      sendHttpStatus(res, 401, "EHR Authentication failed");
      return;
    }
    const token = auth.access_token;
    if (!token) {
      sendHttpStatus(res, 401, "Auth Token not found");
      return;
    }

    //perform EHR query for Appointment and validate required data
    const ehrAppt = await getEhrAppointment(token, configsJson, apptId);
    if (!ehrAppt.length) {
      sendHttpStatus(res, 404, "No Appointment found in EHR query");
      return;
    }
    const matchingAppt = ehrAppt.find((appt) => appt.appointmentid === apptId);
    if (!Object.keys(matchingAppt)) {
      sendHttpStatus(
        res,
        404,
        `Appointment ID not found in EHR appointment query response: ${apptId}`
      );
      return;
    }
    const patientId = matchingAppt.patientid;
    if (!patientId || patientId !== mrn) {
      //make sure it's actually the same patient as request JSON
      sendHttpStatus(
        res,
        404,
        "Patient returned from EHR does not match query patient"
      );
      return;
    }
    const encounterId = matchingAppt.encounterid;
    if (!encounterId) {
      sendHttpStatus(res, 404, "No encounter associated with appointment");
      return;
    }

    //loop through transactions and get procedure and diagnosis codes
    const procedures = getTransactions(transactions); //e.g. [ [ 'C43.4' ], '11100' ]
    if (!Array.isArray(procedures) || procedures.length !== 2) {
      sendHttpStatus(res, 404, "No procedure or diagnosis codes found");
      return;
    }

    //check if procedure code is valid for Encounter
    const cpt = procedures[1]; //e.g. '11100'
    const validCpt = await getProcedurecodes(
      token,
      configsJson,
      encounterId,
      cpt
    );
    if (!Array.isArray(validCpt) || !validCpt.length) {
      sendHttpStatus(res, 404, `Procedure code invalid for Encounter: ${cpt}`);
      return;
    }
    const icds = procedures[0]; //e.g. ['C43.4']
    //send codes to EHR to bill for services
    const createService = await sendEncounterService(
      token,
      configsJson,
      encounterId,
      cpt,
      icds
    );

    if (createService && !createService.error) {
      sendHttpStatus(res, 200, "Success");
      return;
    } else {
      sendHttpStatus(
        res,
        404,
        `Failed to POST financial data to EHR: ${createService.error}`
      );
    }
  } catch (error) {
    sendHttpStatus(res, `Error: ${error}`);
  }
});

//convert string to base64 - used for EHR authentication
const btoa = (value) => Buffer.from(value).toString("base64");

//get appointment ID from Redox Financial Data Model (assume Visit.VisitNumber is Appointment ID)
const getAppointmentId = (appointment) => {
  if (Object.keys(appointment).length) {
    return appointment.VisitNumber;
  } else {
    return;
  }
};

//get EHR auth token from client ID and secret
const getAuth = async (configs) => {
  try {
    const basicAuth = btoa(`${configs.clientId}:${configs.secret}`);
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("scope", "athena/service/Athenanet.MDP.*");
    const response = await fetch(`${configs.baseUrl}${configs.tokenEndpoint}`, {
      //e.g. https://api.preview.platform.athenahealth.com/oauth2/v1/token
      method: "POST",
      body: params,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`
      }
    });
    return response.json();
  } catch (error) {
    console.log(`Error: ${error}`);
  }
};

//get Appointment data from EHR
const getEhrAppointment = async (token, configsJson, apptId) => {
  try {
    const response = await fetch(
      `${configsJson.baseUrl}/v1/${configsJson.practiceId}/appointments/${apptId}`, //e.g. https://api.preview.platform.athenahealth.com/v1/195900/appointments/41474
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        }
      }
    );
    return response.json();
  } catch (error) {
    console.log(`Error: ${error}`);
  }
};

//get patient MRN from Redox Financial Data Model - use ID Type from configs file
const getPatientMrn = (patient, idType) => {
  try {
    if (Object.keys(patient.Identifiers).length) {
      const identifiers = patient.Identifiers;
      const mr = identifiers.find((ids) => ids.IDType === idType); //e.g. IDType === "MR"
      let mrn;
      if (!mr || !Object.keys(mr)) {
        return;
      } else {
        mrn = mr.ID;
      }
      return mrn;
    } else {
      return;
    }
  } catch (error) {
    console.log(`Error: ${error}`);
  }
};

const getProcedurecodes = async (token, configsJson, encounterId, cpt) => {
  let validCpt = false;
  try {
    const response = await fetch(
      `${configsJson.baseUrl}/v1/${configsJson.practiceId}/${encounterId}/procedurecodes?searchvalue=${cpt}`, //e.g. https://api.preview.platform.athenahealth.com/v1/195900/encounter/41474/procedurecodes
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        }
      }
    );
    if (response.totalcount && response.totalcount > "0") {
      validCpt = true;
    }
    return validCpt;
  } catch (error) {
    console.log(`Error: ${error}`);
  }
};

//get ICD-10 and CPT codes from Redox Financial Data Model in Transactions block
const getTransactions = (transactions) => {
  let procedures = [];
  transactions.every(async (transaction) => {
    const diagnoses = transaction.Diagnoses;
    if (!Array.isArray(diagnoses) || !diagnoses.length) {
      return false;
    }
    let icd = [];
    diagnoses.every((diagnosis) => {
      if (diagnosis.Codeset === "ICD-10") {
        icd.push(diagnosis.Code);
      }
    });
    let cpt = "";
    if (transaction.Procedure && transaction.Procedure.Codeset === "CPT") {
      cpt = transaction.Procedure.Code;
    }
    procedures.push(icd, cpt);
  });
  return procedures;
};

//POST billing data to encounter in EHR
const sendEncounterService = async (
  token,
  configsJson,
  encounterId,
  icds,
  cpt
) => {
  try {
    const params = new URLSearchParams();
    params.append("billforservice", "true");
    params.append("icd10codes", icds.toString());
    params.append("modifiers", []); //no Modifiers found in JSON payload
    params.append("procedurecode", cpt);
    params.append("units", "1");

    const response = await fetch(
      `${configsJson.baseUrl}/v1/${configsJson.practiceId}/encounter/${encounterId}/services`, //e.g. https://api.preview.platform.athenahealth.com/v1/195900/encounter/41474/services
      {
        method: "POST",
        body: params,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`
        }
      }
    );
    return response.json();
  } catch (error) {
    console.log(`Error: ${error}`);
  }
};

//send a error status with relevant error text
const sendHttpStatus = (res, status, text) => {
  res.status(status).send(`${text}`);
};

app.listen(port, () => {
  console.log(`Redox app listening at http://localhost:${port}`);
});
