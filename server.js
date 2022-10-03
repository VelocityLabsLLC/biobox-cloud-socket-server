const express = require("express");
const cors = require("cors");
const app = express();
const axios = require("axios");
require("dotenv").config();
app.use(cors());

const PORT = 5000;

const http = require("http").Server(app);
const io = require("socket.io")(http, {
  cors: true,
  origins: ["*"],
});

app.use(express.json()); // Body Parser Middleware

const handleMasterBoxUpdate = async (macAddress, reqBody) => {
  try {
    const res = await axios.patch(
      `${process.env.CLOUD_BACKEND_URL}/${macAddress}`,
      reqBody
    );
    return true;
  } catch (error) {
    return false;
  }
};

app.get("/", (req, res) => {
  res.json({ message: "Socket Server - BioBox Cloud Socket Service" });
});

let masterBoxes = {};
let browsers = {};

io.on("connection", async function (client) {
  // Data From Query Params
  const deviceType = client.handshake.query.deviceType;
  const macAddress = client.handshake.query.macAddress;
  const userId = client.handshake.query.userId;
  if (["masterbox", "browser"].includes(deviceType)) {
    if (deviceType === "masterbox" && !macAddress) {
      // For MasterBox, Mac Address is required
      client.disconnect(true);
      return;
    } else if (deviceType === "browser" && !userId) {
      // For BROWSER, User Id is required
      client.disconnect(true);
      return;
    }
  } else {
    // If not in above value, then force disconnect the client
    client.disconnect(true);
    return;
  }

  if (deviceType === "masterbox") {
    // PATCH CONNECTED TO DB If the device is connecting for the first time
    if (!masterBoxes[macAddress]) {
      const res = await handleMasterBoxUpdate(macAddress, {
        eventType: "connected",
        time: new Date(),
      });

      if (!res) {
        // If the Device with macaddress doesn't exist, then emit error and disconnect
        client.emit("error", "The Specified macAddress does not exist!");
        client.disconnect(true);
        return;
      }
    }

    masterBoxes[macAddress] = client;

    client.on("api-response", ({ userId, response, error }) => {
      if (!userId) {
        // If userId is not found then emit error
        client.emit("error", "userId is required!");
      }
      if (browsers[userId]) {
        browsers[userId].emit("api-response", { data: response, error });
      }
    });

    client.on("deviceData", ({ userId, deviceId, data }) => {
      if (browsers[userId]) {
        browsers[userId].emit(deviceId, data);
      }
    });

    client.on("trialCompleted", ({ userId, data }) => {
      if (browsers[userId]) {
        browsers[userId].emit("trialCompleted", data);
      }
    });

    client.on("disconnect", async () => {
      // PATCH DISCONNECTED TO DB
      await handleMasterBoxUpdate(macAddress, {
        eventType: "disconnected",
        time: new Date(),
      });

      delete masterBoxes[macAddress];
    });
  } else if (deviceType === "browser") {
    // Store Connection REFERENCE for Browser in "browsers"
    browsers[userId] = client;

    client.on("api-request", ({ macAddress, apiData }) => {
      if (!macAddress) {
        client.emit("error", "MacAddress is required!");
      } else if (masterBoxes[macAddress]) {
        // If everything looks good, then hit master box API
        masterBoxes[macAddress].emit("api-request", {
          userId,
          apiData,
        });
      } else {
        // If No Device Connected Found then send Error!
        client.emit(
          "error",
          `Device of macAddress ${macAddress} is Disconnected.`
        );
      }
    });

    client.on("subscribeToDeviceData", ({ macAddress, deviceId }) => {
      if (!masterBoxes[macAddress]) {
        client.emit("error", `No masterbox with ${macAddress} is connected.`);
      } else if (!macAddress || !deviceId) {
        client.emit("error", `Field macAddress and deviceId is required.`);
      } else {
        masterBoxes[macAddress].emit("subscribeToDeviceData", {
          userId,
          macAddress,
          deviceId,
        });
      }
    });

    client.on("unsubscribeToDeviceData", ({ macAddress, deviceId }) => {
      if (!masterBoxes[macAddress]) {
        client.emit("error", `No masterbox with ${macAddress} found.`);
      } else if (!macAddress || !deviceId) {
        client.emit("error", `Field macAddress and deviceId is required.`);
      } else {
        masterBoxes[macAddress].emit("unsubscribeToDeviceData", {
          userId,
          macAddress,
          deviceId,
        });
      }
    });

    client.on("disconnect", () => {
      console.log(`${deviceType} disconnected `);
      // DELETE THE REFERENCE IF THE BROWSER DISCONNECTS.
      delete browsers[userId];
    });
  }
});

http.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
