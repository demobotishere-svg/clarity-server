import app from "./app";
import { startCron } from "./cron";
import "./workers/worker"; // Initialize workers

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Clarity Server (Express) running on port ${PORT}`);
  startCron(); // Start polling
});
