// Dependencies
const express = require("express");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require('openai');
const { Resend } = require("resend");
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
require("dotenv").config();
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const helmet = require('helmet');

const app = express();
const port = 3002;

// Configure Supabase, OpenAI, and Resend
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Create email transport based on environment
const isDevelopment = process.env.NODE_ENV !== 'production';
let emailService;

if (isDevelopment) {
    // Configure Nodemailer with Ethereal for development
    emailService = {
        async sendEmail({ to, from, subject, html }) {
            try {
                const testAccount = await nodemailer.createTestAccount();
                const transporter = nodemailer.createTransport({
                    host: 'smtp.ethereal.email',
                    port: 587,
                    secure: false,
                    auth: {
                        user: testAccount.user,
                        pass: testAccount.pass,
                    },
                });

                const info = await transporter.sendMail({ to, from, subject, html });
                console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
                return info;
            } catch (error) {
                console.error('Error sending email:', error);
                throw error;
            }
        },
    };
} else {
    emailService = new Resend(process.env.RESEND_API_KEY);
}

// Middleware
app.use(bodyParser.json());
app.use(express.static("public"));

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                "https://cdn.jsdelivr.net",
                "https://cdn.tailwindcss.com"
            ],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "https:", "data:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'self'"],
            childSrc: ["'self'"],
            workerSrc: ["'self'"],
            frameAncestors: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: [],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});

const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5 // stricter limit for form generation
});

// Apply rate limiting
app.use(limiter);

// API Key middleware for admin endpoints
const validateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// Input validation middleware
const validateFeedback = [
    body('name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('email').isEmail().normalizeEmail(),
    body('npsScore').isInt({ min: 0, max: 10 }),
    body('feedback').trim().isLength({ min: 1, max: 280 }).escape()
];

const validateFormLink = [
    body('name').trim().isLength({ min: 2, max: 100 }).escape(),
    body('email').isEmail().normalizeEmail()
];

// Serve the HTML template
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/templates/index.html");
});

// API: Submit Feedback
app.post("/api/feedback", validateFeedback, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, npsScore, feedback } = req.body;

    try {
        // Create OpenAI embedding using text-embedding-3-small model
        const embeddingResponse = await openai.embeddings.create({
            input: feedback,
            model: "text-embedding-3-small",  // This model produces 1536 dimensions
            dimensions: 768  // Explicitly request 768 dimensions
        });
        const embedding = embeddingResponse.data[0].embedding;

        // Insert feedback into Supabase
        const { data, error } = await supabase
            .from("feedback")
            .insert({ name, email, nps_score: npsScore, feedback, embedding });

        if (error) throw error;

        await emailService.sendEmail({
            to: email,
            from: isDevelopment ? "test@example.com" : "no-reply@yourdomain.com",
            subject: "Thank you for your feedback!",
            html: `<p>Hi ${name},</p><p>Thank you for sharing your feedback!</p>`,
        });

        res.status(200).json({ message: "Feedback submitted successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to submit feedback." });
    }
});

// API: Summarize Feedback
app.get("/api/summary", validateApiKey, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("feedback")
            .select("feedback");

        if (error) throw error;

        const feedbackTexts = data.map(entry => entry.feedback).join("\n");

        const completion = await openai.completions.create({
            model: "gpt-3.5-turbo-instruct",
            prompt: `Summarize the following feedback:\n${feedbackTexts}`,
            max_tokens: 150,
        });

        res.status(200).json({ summary: completion.choices[0].text.trim() });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to summarize feedback." });
    }
});

// Add this new endpoint
app.post("/api/generate-form-link", strictLimiter, validateFormLink, validateApiKey, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, name } = req.body;
    
    try {
        const token = jwt.sign(
            { email, name },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        const formUrl = `${req.protocol}://${req.get('host')}/?token=${token}`;
        
        await emailService.sendEmail({
            to: email,
            from: isDevelopment ? "test@example.com" : "no-reply@yourdomain.com",
            subject: "Your Feedback Form Link",
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2>Hello ${name},</h2>
                    <p>We value your feedback! Please click the link below to share your thoughts with us:</p>
                    <p style="margin: 20px 0;">
                        <a href="${formUrl}" 
                           style="background-color: #D55672; 
                                  color: white; 
                                  padding: 12px 24px; 
                                  text-decoration: none; 
                                  border-radius: 6px; 
                                  display: inline-block;">
                            Share Your Feedback
                        </a>
                    </p>
                    <p style="color: #666; font-size: 14px;">This link will expire in 24 hours.</p>
                    <p style="color: #666; font-size: 14px;">If the button doesn't work, you can copy and paste this URL into your browser:</p>
                    <p style="color: #666; font-size: 14px; word-break: break-all;">${formUrl}</p>
                </div>
            `
        });
        
        res.json({ 
            message: "Form link generated and sent to email",
            url: formUrl
        });
    } catch (error) {
        console.error('Error generating form link:', error);
        res.status(500).json({ error: "Failed to generate form link" });
    }
});

// Add this endpoint to verify tokens
app.post("/api/verify-token", async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({ error: "Token is required" });
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.json({
            name: decoded.name,
            email: decoded.email
        });
    } catch (error) {
        res.status(401).json({ error: "Invalid or expired token" });
    }
});

// Add this new route after your existing routes
app.get("/docs", (req, res) => {
    res.sendFile(__dirname + "/templates/docs.html");
});

// Start the Server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
