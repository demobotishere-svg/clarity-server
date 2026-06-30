async function simulateIncomingMessage() {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1234567890",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "1234567890",
                phone_number_id: "1234567890"
              },
              contacts: [
                {
                  profile: {
                    name: "Local Test User"
                  },
                  wa_id: "919999999999" // Fake unrecognized number
                }
              ],
              messages: [
                {
                  from: "919999999999", // Must match wa_id
                  id: `wamid.test_${Date.now()}`,
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  text: {
                    body: "Hi, I want to take the assessment!"
                  },
                  type: "text"
                }
              ]
            },
            field: "messages"
          }
        ]
      }
    ]
  };

  try {
    console.log("Sending synthetic webhook payload to http://localhost:3000/api/whatsapp/webhook ...");
    const response = await fetch("http://localhost:3000/api/whatsapp/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    console.log(`Response Status: ${response.status}`);
    console.log(`Response Body: ${text}`);
    
    if (response.ok) {
      console.log("✅ Webhook processed successfully! Check your server logs and admin dashboard.");
    } else {
      console.log("❌ Webhook failed.");
    }
  } catch (err) {
    console.error("Error connecting to local server:", err.message);
  }
}

simulateIncomingMessage();
