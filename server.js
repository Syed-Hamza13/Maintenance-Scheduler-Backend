import dotenv from "dotenv";
dotenv.config();

import express from "express";
import multer from "multer";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { extractIFCData } from "./testifc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use("/files", express.static(path.join(__dirname, "uploads")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "uploads"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

// 🔥 BACKGROUND PROCESS
async function processIFC(projectId, filePath) {
  try {
    console.log("🚀 Processing IFC:", filePath);

    const data = await extractIFCData(filePath);

    await supabase
      .from("schedules")
      .update({
        data: data,
        status: "ready",
      })
      .eq("project_id", projectId);

    console.log("✅ IFC processed");
  } catch (err) {
    console.error("❌ IFC ERROR:", err);
  }
}

// ✅ UPLOAD
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { user_id } = req.body;

    const { data: project, error } = await supabase
      .from("projects")
      .insert([
        {
          user_id,
          file_name: req.file.originalname,
          file_path: req.file.filename,
        },
      ])
      .select()
      .single();

    if (error) throw error;

    // 🔥 create processing schedule
    await supabase.from("schedules").insert([
      {
        project_id: project.id,
        status: "processing",
        data: null,
      },
    ]);

    // async processing
    processIFC(
      project.id,
      path.join(__dirname, "uploads", req.file.filename)
    );

    res.json({
      success: true,
      project_id: project.id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// ✅ GET PROJECTS
app.get("/projects/:user_id", async (req, res) => {
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", req.params.user_id)
    .order("created_at", { ascending: false });

  res.json({ success: true, projects: data });
});

// 🔥 FIXED SCHEDULE API
app.get("/schedule/:project_id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("schedules")
      .select("*")
      .eq("project_id", req.params.project_id);

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.json({
        status: "processing",
        data: null,
      });
    }

    return res.json(data[0]);
  } catch (err) {
    console.error(err);
    res.json({
      status: "processing",
      data: null,
    });
  }
});

app.listen(5000, () => console.log("Server running"));