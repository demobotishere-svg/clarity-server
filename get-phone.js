async function run() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const res = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
run();
