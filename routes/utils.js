import express from "express";
const router = express.Router();
import { checkProposals } from "../controllers/utilsController.js";

router.post("/checkNewProposals", checkProposals);

export default router;
