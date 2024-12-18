require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const path = require('path');

const app = express();
app.use(express.json());

const corsOptions = {
    origin: 'https://easthma.ca', // Make sure this matches your frontend domain exactly
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // Include cookies/credentials if needed
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight OPTIONS requests

// User Schema
const sessionSchema = new mongoose.Schema({
    sessionId: { type: Number },
    sessionIdList: { type: Array, default: [] },
    name: { type: String },
    email: { type: String },
    token: { type: String }, 
    verified: { type: Boolean, default: false }, 
    preTest: { type: Boolean, default: false },
    postTest: { type: Boolean, default: false },
    completed: { type: Boolean, default: false },
    preTestAnswers: { type: Object, default: {} },
    postTestAnswers: { type: Object, default: {} }
});

const Session = mongoose.model('Session', sessionSchema);

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connected to MongoDB successfully'))
    .catch((err) => console.error('Failed to connect to MongoDB:', err));

const transporter = nodemailer.createTransport({
    host: "mail.easthma.ca",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    }
});


app.post('/submit-posttest', async (req, res) => {
    const { sessionId, answers } = req.body;

    if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required.' });
    }

    if (!answers || Object.keys(answers).length === 0) {
        return res.status(400).json({ message: 'Answers are required.' });
    }

    try {
        const session = await Session.findOne({ sessionId });

        if (!session) {
            return res.status(404).json({ message: 'Session not found.' });
        }

        session.postTestAnswers = answers;
        session.postTest = true;
        session.completed = true;

        session.sessionIdList.push(session.sessionId);
        await session.save();

        res.json({ message: 'Post-test marked as complete' });
    } catch (error) {
        console.error('Error submitting post-test:', error);
        res.status(500).json({ message: 'Failed to submit post-test.' });
    }
});


app.get('/get-posttest-answers', async (req, res) => {
    const { sessionId } = req.query;

    if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required.' });
    }

    try {
        const session = await Session.findOne({ sessionId });

        if (!session) {
            return res.status(404).json({ message: 'Session not found.' });
        }

        if(session.postTest) {
            res.json({ postTestAnswers: session.postTestAnswers});
        } else {
            res.status(400).json({ message: 'Post-test not completed' });
        }

    } catch (error) {
        console.error('Error fetching post-test answers:', error);
        res.status(500).json({ message: 'Failed to fetch post-test answers.' });
    }
});


app.post('/send-verification', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    try {
        let session = await Session.findOne({ email });

        if (session && session.verified && !session.completed) {
            return res.json({ message: 'Session already exists', sessionId: session.sessionId });
        }

        const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1h' });

        let sessionId;
        do {
            sessionId = Math.floor(100 + Math.random() * 900);
        } while (await Session.findOne({ sessionId }) || (session && session.sessionIdList.includes(sessionId)));

        if (session) {
            if (!session.completed) {
                return res.json({ message: 'Session already exists', sessionId: session.sessionId });
            } else {
                session.completed = false;
                session.preTest = false;
                session.postTest = false;
                session.sessionId = sessionId;
                await session.save();
            }
        } else {
            session = new Session({ email, token, verified: false, sessionId });
            await session.save();
            const verificationLink = `https://api.easthma.ca/verify-email?token=${token}`;

            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Please Verify Your Email - CFP Mainpro+ Credits for The Electronic Asthma Management System (eAMS)',
                html: `<p>Hello,</p>
    
                <p> Thank you using the Electronic Asthma Management System learning activity. To verify your email and proceed with completing your pre-test, please click on the link below: </p>
                <a href="${verificationLink}">Verify Email</a> <br>
                
                <p>After completing the pre-test, we recommend reviewing the <a href="https://easthma.ca/mp_instructions#go1">linked articles</a> and interacting with the eAMS on a minimum of 5 patients before completing the <a href="https://easthma.ca/mp_instructions#go2">post-test</a> and evaluation form. You can earn up to 6 credits for a single application (estimated 2 hours, at 3 credits/hour), up to a maximum of 72 credits per year (e.g. if you repeat the activity monthly). You can learn more about this on our <a href="https://easthma.ca/mainpro">website</a>. </p>
    
                <p>If you have any questions or need any assistance, please let us know. <p>
    
                <p>Kind regards,</p>
                <p>eAMS Support Team</p>
                `
            });
    
            res.json({ message: 'Verification email sent. Please verify your email before proceeding.' });
    
        }
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ message: 'Failed to send verification email' });
    }
});

app.post('/check-pretest-completion', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }


    try {
        const session = await Session.findOne({ email });

        if (!session) {
            return res.status(404).json({ message: 'No session found for this email. Please complete the pre-test first.' });
        }
        if (!session.preTest) {
            return res.status(400).json({ message: 'Pre-test not completed. Please complete the pre-test before proceeding.', completed: false });
        }
        res.json({ sessionId: session.sessionId, message: 'Pre-test has been completed.', completed: true });
    } catch (error) {
        console.error('Error verifying pre-test completion:', error);
        res.status(500).json({ message: 'Failed to verify pre-test completion' });
    }
});

app.get('/verify-email', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.status(400).json({ message: 'Token is required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { email } = decoded;

        const session = await Session.findOneAndUpdate(
            { email },
            { verified: true },
            { new: true }
        );

        if (!session) {
            return res.status(404).json({ message: 'Session not found or already verified' });
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Email Verified</title>
            </head>
            <body style="display: flex; align-items: center; justify-content: center; height: 100vh; font-family: Arial, sans-serif;">
                <div style="text-align: center;">
                    <h1 style="color: #58B4E5;">Email Verified</h1>
                    <p>Your email has been successfully verified. Please close this window and complete your pre-test in your original window.</p>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error verifying email:', error);
        res.status(400).json({ message: 'Invalid or expired token' });
    }
});

app.post('/submit-pretest', async (req, res) => {
    const { sessionId, userName, email, answers } = req.body;

    if (!sessionId || !userName) {
        return res.status(400).json({ message: 'Session ID and Name are required' });
    }

    try {
        const session = await Session.findOne({ sessionId });

        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        if (session.preTest) {
            return res.status(400).json({ message: 'Pre-Test has already been submitted.' });
        }

        session.preTest = true;
        session.name = userName;
        session.preTestAnswers = answers;
        if (email) {
            session.email = email;
        }
        await session.save();

        res.json({ message: 'Pre-Test marked as complete' });
    } catch (error) {
        console.error('Error updating pretest status:', error);
        res.status(500).json({ message: 'Failed to update pretest status' });
    }
});

app.post('/verify-posttest', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    try {
        const session = await Session.findOne({ email });

        if (!session) {
            return res.status(404).json({ message: 'No session found for this email. Please complete the pretest first.' });
        }

        if (!session.preTest) {
            return res.status(400).json({ message: 'Pretest not completed. Please complete the pretest before taking the post-test.' });
        }

        res.json({ sessionId: session.sessionId });
    } catch (error) {
        console.error('Error verifying post-test status:', error);
        res.status(500).json({ message: 'Failed to verify post-test eligibility' });
    }
});

app.get('/get-pretest-answers', async (req, res) => {
    const { sessionId } = req.query;

    if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
    }

    try {
        const session = await Session.findOne({ sessionId });

        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        if (session.preTest) {
            res.json({ preTestAnswers: session.preTestAnswers });
        } else {
            res.status(400).json({ message: 'Pre-test not completed' });
        }
    } catch (error) {
        console.error('Error fetching pretest answers:', error);
        res.status(500).json({ message: 'Failed to fetch pretest answers' });
    }
});

  
app.post('/get-session', async (req, res) => {
    const { email } = req.body;
    res.header('Access-Control-Allow-Origin', '*'); 

    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    try {
        const session = await Session.findOne({ email });
        if ((session && session.verified && !session.completed)) {
            return res.json({ sessionId: session.sessionId });
        } else {
            return res.status(403).json({ message: 'Email not verified. Please verify your email to continue.' });
        }
    } catch (error) {
        console.error('Error fetching session:', error);
        res.status(500).json({ message: 'Failed to fetch session' });
    }
});

app.get('/generate-certificate', async (req, res) => {
    const { sessionId } = req.query;

    if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required.' });
    }

    try {
        const session = await Session.findOne({ sessionId });

        if (!session) {
            return res.status(404).json({ message: 'Session not found.' });
        }

        const doc = new PDFDocument();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=certificate_${sessionId}.pdf`);

        doc.pipe(res);

        const borderWidth = 10;

        doc.save()
        .lineWidth(borderWidth)
        .strokeColor('#ADD8E6')
        .rect(borderWidth / 2, borderWidth / 2, doc.page.width - borderWidth, doc.page.height - borderWidth)
        .stroke();
     

        const imagePath = path.join(__dirname, 'eams.png');
        const pageWidth = doc.page.width;
        const imageWidth = 250;
        const imageHeight = 100;
        const imageX = (pageWidth - imageWidth) / 2; 
        const imageY = 30;

        const date = new Date();
        const formattedDate = `${date.toLocaleString('en-US', { month: 'long' })} ${date.getDate()}, ${date.getFullYear()}`;

        doc.image(imagePath, imageX, imageY, { width: imageWidth, height: imageHeight });

        doc.moveDown(5);

        doc
            .fontSize(22)
            .text('Certificate of Attendance', { align: 'center' })
        doc
            .fontSize(20)
            .text('Continuing Professional Development', { align: 'center' })
            .moveDown(2);

        doc
            .fontSize(18)
            .text(`This is to certify that`, { align: 'center' })

        doc
            .font('Helvetica-Bold')
            .fontSize(18)
            .text(session.name || 'Unknown User', { align: 'center', underline: true })
            .moveDown(2);

        doc
            .font('Helvetica')
            .fontSize(18)
            .text('has completed the continuing development program titled', { align: 'center'})
            .moveDown(1);

        doc
            .font('Helvetica-Bold')
            .fontSize(18)
            .text('The Electronic Asthma Management system - Learning Activity (ID-202678)', { align: 'center', bold: 'true'})
            .moveDown(1);

        doc
            .fontSize(16)
            .text(`CERT + Session ID: ${sessionId}`, { align: 'center' })
            .moveDown(1);


        doc
            .font('Helvetica')
            .fontSize(15)
            .text(`On`, { align: 'center' })

        doc
            .fontSize(15)
            .text(`Date: ${formattedDate}`, { align: 'center' });

        doc
            .fontSize(15)
            .text(`At their own location`, { align: 'center' })
            .moveDown(3);


        doc
            .font('Helvetica-Bold')
            .fontSize(13)
            .text(`Credits for Family Physicians`, { align: 'center', bold: true })

        doc
            .font('Helvetica')
            .fontSize(13)
            .text(`This 3-credit-per-hour activity has been certified by the College of Family Physicians of Canada for up to 72 Mainpro+ Certified Activity credits.`, { align: 'center', bold: true })
            .moveDown(3)

        doc
            .fontSize(11)
            .text(`Claiming your credits: Please submit your credits for this activity online at www.cfpc.ca/login. Please retain proof of your participation for six (6) years in case you are selected to participate in credit validation or auditing.`, { align: 'center', bold: true })



        doc.end();

    } catch (error) {
        console.error('Error generating certificate:', error);
        res.status(500).json({ message: 'Failed to generate certificate.' });
    }
});

app.delete('/clear-database', async (req, res) => {
    try {
        console.log('Clearing database...');
        const result = await Session.deleteMany({});
        console.log(`Deleted ${result.deletedCount} documents`);
        res.json({
            message: 'Database cleared successfully',
            deletedCount: result.deletedCount,
        });
    } catch (error) {
        console.error('Error clearing the database:', error);
        res.status(500).json({ message: 'Failed to clear the database', error });
    }
});

app.get('/all-sessions', async (req, res) => {
    try {
        const sessions = await Session.find();
        res.json(sessions);
    } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).json({ message: "Failed to fetch sessions" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});