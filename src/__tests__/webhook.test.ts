import request from "supertest";
import crypto from "crypto";
import app from "../app";

const APP_SECRET = process.env.WHATSAPP_APP_SECRET || "test-secret";
process.env.WHATSAPP_APP_SECRET = APP_SECRET;
process.env.NODE_ENV = "test";

describe("WhatsApp Webhook", () => {
  it("should return 200 OK and handle a valid text message without crashing", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{
        id: "test_entry_id",
        changes: [{
          value: {
            messages: [{
              from: "919876543210",
              id: `test_msg_${Date.now()}`,
              text: { body: "start assessment" }
            }],
            metadata: { phone_number_id: "test_phone_id" }
          },
          field: "messages"
        }]
      }]
    };

    const rawBody = JSON.stringify(payload);
    const signature = "sha256=" + crypto
      .createHmac("sha256", APP_SECRET)
      .update(rawBody)
      .digest("hex");

    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .set("x-hub-signature-256", signature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.text).toBe("OK");
  });

  it("should return 401 Unauthorized for invalid signature", async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: []
    };

    const res = await request(app)
      .post("/api/whatsapp/webhook")
      .set("x-hub-signature-256", "sha256=invalid_signature")
      .send(payload);

    expect(res.status).toBe(401);
  });
});
