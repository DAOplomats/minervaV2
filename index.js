import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import daoRouter from "./routes/dao.js";
import chainRouter from "./routes/chain.js";
import utilsRouter from "./routes/utils.js";
import proposalRouter from "./routes/proposal.js";
import redis from "./utils/redis.js";
import { listenerQueue, loadPendingExecutionJobs } from "./utils/queue.js";
import { startListener } from "./utils/listener.js";

dotenv.config();

const app = express();

const id = (Math.random() * 1000).toString();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Minerva Backend is running 🚀");
});

app.use("/api/dao", daoRouter);
app.use("/api/chain", chainRouter);
app.use("/api/utils", utilsRouter);
app.use("/api/proposal", proposalRouter);

// Redis connection
redis.on("connect", async () => {
  console.log("Successfully connected to Redis");

  startListener(id);
  loadPendingExecutionJobs(true);
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err);
});

process.on("SIGINT", () => {
  redis.disconnect();
  listenerQueue.empty();

  console.log("Successfully disconnected from Redis");
  process.exit(0);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
