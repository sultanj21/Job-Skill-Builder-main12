// ---------- ENV + IMPORTS ----------
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const schedulerRoutes = require("./schedulerRoutes");
const elevatorRoutes = require("./elevatorRoutes");

const app = express();

// ---------- SUPABASE CONFIG ----------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("🔗 Supabase Dashboard:", supabaseUrl);

// ---------- UPLOADS (MULTER) ----------
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const userId = (req.session && req.session.user && req.session.user.id) || "anon";
        const safeOriginal = file.originalname.replace(/[^\w.\-]/g, "_");
        cb(null, `${userId}_${Date.now()}_${safeOriginal}`);
    },
});

const upload = multer({ storage });

// ---------- MIDDLEWARE ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SESSION_SECRET || "dev_secret_change_me",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24, // 1 day
        },
    })
);

// Static files (public) + uploads
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadsDir));

// ---------- AUTH MIDDLEWARE ----------
function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect("/login.html");
    }
    next();
}

// ---------- API ROUTES (scheduler + elevator) ----------
app.use("/api", schedulerRoutes);
app.use("/api", elevatorRoutes);

// ---------- BASIC PAGES ----------
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Make /register redirect to the personal step (for convenience)
app.get("/register", (req, res) => {
    res.redirect("/register-personal");
});

// Step 1 – personal info
app.get("/register-personal", (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "register_personal_information.html")
    );
});

// Step 2 – address
app.get("/register-address", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "register_address.html"));
});

// Step 3 – college / education
app.get("/register-college", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "register_college.html"));
});

// Dashboard + Jobs + Elevator + Scheduler + Resume (protected)
app.get("/dashboard", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/jobs", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "jobs.html"));
});

app.get("/elevator", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "elevator.html"));
});

app.get("/scheduler", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "scheduler.html"));
});

// New AI Resume page
app.get("/resume", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "resume.html"));
});

// ---------- API: CURRENT USER (NO requireAuth HERE) ----------
app.get("/api/me", async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(200).json({
                success: false,
                message: "Not logged in",
            });
        }

        const userId = req.session.user.id;

        const { data, error } = await supabase
            .from("users")
            .select(
                "id, firstname, lastname, fullname, birthday, email, occupation, street, city, state, zip, college, certificate, graddate, profilepicpath, created_at"
            )
            .eq("id", userId)
            .maybeSingle();

        if (error) {
            console.error("Supabase /api/me error:", error);
            return res.status(500).json({
                success: false,
                message: "Database error",
            });
        }

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        res.json({ success: true, user: data });
    } catch (err) {
        console.error("/api/me unexpected error:", err);
        res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
});

// ---------- API: REGISTER ----------
app.post("/register", async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            birthday,
            email,
            occupation,
            password,
            street,
            city,
            state,
            zip,
            college,
            certificate,
            gradDate,
        } = req.body;

        if (
            !firstName ||
            !lastName ||
            !birthday ||
            !email ||
            !occupation ||
            !password
        ) {
            return res.json({
                success: false,
                message: "Please fill in all required fields.",
            });
        }

        const { data: existing, error: existingErr } = await supabase
            .from("users")
            .select("id")
            .eq("email", email)
            .maybeSingle();

        if (existingErr) {
            console.error("Supabase existingErr:", existingErr);
            return res.json({
                success: false,
                message: "Database error. Try again.",
            });
        }

        if (existing) {
            return res.json({
                success: false,
                message: "Email already exists.",
            });
        }

        const hashed = await bcrypt.hash(password, 10);

        const { error: insertErr } = await supabase
            .from("users")
            .insert({
                firstname: firstName,
                lastname: lastName,
                fullname: `${firstName} ${lastName}`,
                birthday,
                email,
                occupation,
                password_hash: hashed,
                street,
                city,
                state,
                zip,
                college,
                certificate,
                graddate: gradDate,
            })
            .select()
            .single();

        if (insertErr) {
            console.error("Supabase insertErr:", insertErr);
            return res.json({
                success: false,
                message: "Server error. Try again.",
            });
        }

        return res.json({
            success: true,
            message: "Registration successful. You can now log in.",
        });
    } catch (err) {
        console.error("/register unexpected error:", err);
        return res.json({
            success: false,
            message: "Server error. Try again.",
        });
    }
});

// ---------- API: LOGIN ----------
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.json({
                success: false,
                message: "Please enter email and password.",
            });
        }

        const { data: user, error } = await supabase
            .from("users")
            .select("id, fullname, password_hash")
            .eq("email", email)
            .maybeSingle();

        if (error) {
            console.error("Supabase login error:", error);
            return res.json({
                success: false,
                message: "Database error. Try again.",
            });
        }

        if (!user) {
            return res.json({
                success: false,
                message: "Invalid email or password.",
            });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.json({
                success: false,
                message: "Invalid email or password.",
            });
        }

        req.session.user = {
            id: user.id,
            fullname: user.fullname,
            email,
        };

        return res.json({
            success: true,
            message: "Login successful.",
        });
    } catch (err) {
        console.error("/login unexpected error:", err);
        return res.json({
            success: false,
            message: "Server error. Try again.",
        });
    }
});

// ---------- API: LOGOUT ----------
app.post("/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: "Logged out." });
    });
});

// ---------- FILE UPLOAD ENDPOINTS (Dashboard) ----------

// Resume upload from dashboard "Resume" tab
app.post("/upload-resume", requireAuth, upload.single("resume"), (req, res) => {
    try {
        if (!req.file) {
            return res.json({
                success: false,
                message: "No file uploaded.",
            });
        }

        // (Optional) You could store resume file info in DB later
        return res.json({
            success: true,
            message: "Resume uploaded.",
            filename: req.file.originalname,
        });
    } catch (err) {
        console.error("/upload-resume error:", err);
        return res.json({
            success: false,
            message: "Server error. Try again.",
        });
    }
});

// Profile picture upload from dashboard "Profile Photo" tab
app.post(
    "/upload-profile-pic",
    requireAuth,
    upload.single("profilePic"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.json({
                    success: false,
                    message: "No image uploaded.",
                });
            }

            const userId = req.session.user.id;
            const relativePath = `/uploads/${path.basename(req.file.path)}`;

            const { error } = await supabase
                .from("users")
                .update({ profilepicpath: relativePath })
                .eq("id", userId);

            if (error) {
                console.error("Supabase profile pic update error:", error);
                return res.json({
                    success: false,
                    message: "Could not save image path to database.",
                });
            }

            return res.json({
                success: true,
                message: "Profile photo updated.",
                path: relativePath,
            });
        } catch (err) {
            console.error("/upload-profile-pic error:", err);
            return res.json({
                success: false,
                message: "Server error. Try again.",
            });
        }
    }
);

// ---------- AI RESUME TOOL ENDPOINTS ----------

// Upload + extract stub: used by resume.js (/api/upload)
app.post("/api/upload", requireAuth, upload.single("resume"), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                message: "No resume file uploaded.",
            });
        }

        // In a real version you'd parse the PDF/DOCX here.
        // For now we just send a stub message back.
        return res.json({
            message: "Resume uploaded. Paste or edit the text in the box.",
            resumeText: "",
            skills: [],
        });
    } catch (err) {
        console.error("/api/upload error:", err);
        return res.status(500).json({
            message: "Server error while processing resume.",
        });
    }
});

// AI resume reformatter stub: used by resume.js (/api/resume/reformatter)
app.post("/api/resume/reformatter", requireAuth, async (req, res) => {
    try {
        const { resumeText, jobDescription } = req.body || {};

        if (!resumeText || !jobDescription) {
            return res.status(400).json({
                message: "Please provide both resume text and job description.",
            });
        }

        // Simple stub "AI" logic for now
        const summary = `Tailored for this role, highlighting your key experience and skills mentioned in the job description.`;
        const tailoredResume =
            resumeText +
            "\n\n---\nTailored for job description above. Make sure to double-check bullet points and dates.";

        const emphasizedSkills = [];
        const suggestions = [
            "Move the most relevant experience to the top.",
            "Add 2–3 bullets that mention technologies from the job posting.",
            "Keep everything to 1–2 pages and use consistent bullet formatting.",
        ];

        return res.json({
            summary,
            tailoredResume,
            emphasizedSkills,
            suggestions,
        });
    } catch (err) {
        console.error("/api/resume/reformatter error:", err);
        return res.status(500).json({
            message: "Server error while tailoring resume.",
        });
    }
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
