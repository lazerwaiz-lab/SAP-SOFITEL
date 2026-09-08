const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname)));

// Middleware de vérification d'authentification pour bloquer les écritures non autorisées
const verifyAuthToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "Accès refusé. Token manquant." });
    }
    const token = authHeader.split('Bearer ')[1];
    
    if (token === "SAP_SECRET_TOKEN_2026") {
        next();
    } else {
        res.status(403).json({ error: "Token invalide." });
    }
};

// Route d'écriture / modification sécurisée
app.post('/api/staff', verifyAuthToken, async (req, res) => {
    try {
        const { id, ...data } = req.body;
        await db.collection('sofitel_cotonou_staff').doc(id).set(data);
        res.status(200).json({ success: true, message: "Employé enregistré avec succès." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Route de suppression sécurisée
app.delete('/api/staff/:id', verifyAuthToken, async (req, res) => {
    try {
        await db.collection('sofitel_cotonou_staff').doc(req.params.id).delete();
        res.status(200).json({ success: true, message: "Employé supprimé avec succès." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Route pour récupérer tous les employés (pour le tableau de bord admin)
app.get('/api/staff', async (req, res) => {
    try {
        const snapshot = await db.collection('sofitel_cotonou_staff').get();
        const staffList = [];
        snapshot.forEach(doc => {
            staffList.push({ id: doc.id, ...doc.data() });
        });
        res.status(200).json(staffList);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Route pour récupérer un employé spécifique par son ID ou sftId (pour le scanner)
app.get('/api/staff/:id', async (req, res) => {
    try {
        const searchId = decodeURIComponent(req.params.id).trim();
        let docRef = db.collection('sofitel_cotonou_staff').doc(searchId);
        let docSnap = await docRef.get();

        if (docSnap.exists) {
            return res.status(200).json(docSnap.data());
        }

        const snapshot = await db.collection('sofitel_cotonou_staff')
            .where('sftId', '==', searchId)
            .get();

        if (!snapshot.empty) {
            return res.status(200).json(snapshot.docs[0].data());
        }

        res.status(404).json({ error: "Employé non trouvé" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.listen(3005, () => {
    console.log('Serveur backend SAP démarré sur http://localhost:3005');
});