import dotenv from "dotenv";

dotenv.config();
import express from "express";
import multer from "multer";
import cors from "cors";
import path from "path"; 
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// 🔥 Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// static files
app.use("/files", express.static(path.join(__dirname, "uploads")));

// storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "uploads"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

// ✅ upload route (UPDATED)
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false, 
        message: "No file uploaded", 
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "User ID required",
      });
    }

    const fileName = req.file.filename;

    console.log("FILE RECEIVED:", fileName);

    // 🔥 SAVE TO DB
    const { error } = await supabase.from("projects").insert([
      {
        user_id: user_id,
        file_name: req.file.originalname,
        file_path: fileName,
      },
    ]);

    if (error) {
      console.error("DB ERROR:", error);
      return res.status(500).json({
        success: false,
        message: "DB insert failed",
      });
    }

    return res.status(200).json({
      success: true,
      message: "File uploaded & saved",
      file: fileName,
    });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Upload failed",
    });
  }
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
}); 