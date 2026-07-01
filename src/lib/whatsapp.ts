export async function sendWhatsAppMessage(to: string, message: string) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.warn("WhatsApp API credentials missing. Skipping message send.");
    return;
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("WhatsApp API Error Response:", data);
      throw new Error(`Failed to send WhatsApp message: ${JSON.stringify(data)}`);
    }
    
    return data;
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    throw error;
  }
}

export async function sendWhatsAppTemplate(to: string, templateName: string, languageCode: string = "en_US", components?: any[]) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.warn("WhatsApp API credentials missing.");
    return;
  }

  try {
    const payload: any = {
      messaging_product: "whatsapp",
      to: to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode }
      }
    };

    if (components && components.length > 0) {
      payload.template.components = components;
    }

    const res = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("WhatsApp Template Error:", data);
      throw new Error(`Failed to send Template: ${JSON.stringify(data)}`);
    }
    return data;
  } catch (error) {
    console.error("Error sending template:", error);
    throw error;
  }
}

export async function sendWhatsAppDocument(to: string, documentUrl: string, filename: string, caption?: string) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.warn("WhatsApp API credentials missing.");
    return;
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "document",
        document: {
          link: documentUrl,
          filename: filename,
          caption: caption
        }
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("WhatsApp Document Error:", data);
      throw new Error(`Failed to send Document: ${JSON.stringify(data)}`);
    }
    return data;
  } catch (error) {
    console.error("Error sending document:", error);
    throw error;
  }
}
