import express from "express";
const router = express.Router();
import { addDao } from "../controllers/daoController.js";

router.post("/add", addDao);

export default router;
