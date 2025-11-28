import express from "express";
const router = express.Router();
import { addDao, listDaos } from "../controllers/daoController.js";

router.post("/add", addDao);
router.get("/list", listDaos);

export default router;
