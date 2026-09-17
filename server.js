require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer'); // <--- Indispensable pour l'upload
const { createClient } = require('@supabase/supabase-js'); // <--- Indispensable pour Supabase
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Chargement sécurisé de Firebase (Compatible Local et Render)
let serviceAccount;
if (process.env.FIREBASE_PRIVATE_KEY) {
    serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID || "sap-sofitel",
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
        universe_domain: "googleapis.com"
    };
} else {
    serviceAccount = require('./serviceAccountKey.json');
}

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname)));

// Configuration de Multer (mémoire tampon)
const upload = multer({ storage: multer.memoryStorage() });

// Initialisation de Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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

// ==========================================
// NOUVEAU : ROUTE DE VÉRIFICATION DU MOT DE PASSE ADMIN POUR LE FRONT-END
// ==========================================
app.post('/api/verify-admin', async (req, res) => {
    try {
        const { password } = req.body;
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (!adminPassword) {
            return res.status(500).json({ success: false, message: "Configuration serveur incomplète (mot de passe admin manquant)." });
        }

        if (password !== adminPassword) {
            return res.status(401).json({ success: false, message: "Mot de passe administrateur incorrect !" });
        }

        res.json({ success: true, message: "Mot de passe correct." });
    } catch (error) {
        console.error("Erreur vérification admin :", error);
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});


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

// Route pour supprimer un employé et l'archiver dans 'sofitel_cotonou_staff_gone'
app.delete('/api/staff/:id', async (req, res) => {
    try {
        const { password } = req.body;
        const adminPassword = process.env.ADMIN_PASSWORD;
        
        // Sécurisé avec process.env
        if (!adminPassword || password !== adminPassword) {
            return res.status(403).json({ 
                success: false, 
                message: "Accès refusé : mot de passe administrateur incorrect ou non configuré." 
            });
        }

        const staffId = req.params.id;

        const activeDocRef = db.collection('sofitel_cotonou_staff').doc(staffId);
        const docSnap = await activeDocRef.get();

        if (!docSnap.exists) {
            return res.status(404).json({
                success: false,
                message: "Employé introuvable dans la base de données."
            });
        }

        const staffData = docSnap.data();

        const archiveData = {
            ...staffData,
            deletedAt: new Date().toISOString()
        };

        const archiveDocRef = db.collection('sofitel_cotonou_staff_gone').doc(staffId);

        const batch = db.batch();
        batch.set(archiveDocRef, archiveData); 
        batch.delete(activeDocRef);            

        await batch.commit();

        res.json({ 
            success: true, 
            message: "Employé supprimé et archivé avec succès." 
        });

    } catch (error) {
        console.error("Erreur lors de la suppression/archivage :", error);
        res.status(500).json({ 
            success: false, 
            message: "Erreur interne du serveur : " + error.message
        });
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

// Route d'upload vers Supabase Storage
app.post('/upload-photo', upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Aucun fichier fourni." });
        }

        const fileExt = req.file.originalname.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
        const filePath = `staff-photos/${fileName}`;

        const { data, error } = await supabase.storage
            .from('staff-photos') 
            .upload(filePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        if (error) throw error;

        const { data: publicUrlData } = supabase.storage
            .from('staff-photos')
            .getPublicUrl(filePath);

        res.json({ url: publicUrlData.publicUrl });
    } catch (err) {
        console.error("Erreur Supabase Storage:", err);
        res.status(500).json({ error: err.message });
    }
});

// Route centralisée pour exécuter les actions sécurisées sur la base de données
app.post('/api/executeDbAction', async (req, res) => {
    try {
        const { password, action, collection, id } = req.body;
        const adminPassword = process.env.ADMIN_PASSWORD;

        // 1. Vérification stricte du mot de passe administrateur sécurisé
        if (!adminPassword || password !== adminPassword) {
            return res.status(403).json({ 
                success: false, 
                message: "Accès refusé : mot de passe administrateur incorrect ou non configuré." 
            });
        }

        // 2. Gestion des actions (ex: suppression)
        if (action === 'delete') {
            if (!collection || !id) {
                return res.status(400).json({ success: false, message: "Paramètres manquants." });
            }

            // Correction : Utilisation de "db" à la place de "admin.firestore()"
            await db.collection(collection).doc(id).delete();

            return res.json({ 
                success: true, 
                message: "Suppression effectuée avec succès." 
            });
        }

        res.status(400).json({ success: false, message: "Action inconnue." });

    } catch (error) {
        console.error("Erreur serveur executeDbAction :", error);
        res.status(500).json({ 
            success: false, 
            message: "Erreur interne du serveur : " + error.message 
        });
    }
});

// 1. Récupérer la liste des utilisateurs supprimés (staff_gone)
app.get('/api/staff-gone', async (req, res) => {
    try {
        const snapshot = await db.collection('sofitel_cotonou_staff_gone').get();
        const staffList = [];
        snapshot.forEach(doc => {
            staffList.push({ id: doc.id, ...doc.data() });
        });
        res.json(staffList);
    } catch (error) {
        console.error("Erreur fetch staff-gone:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Restaurer un utilisateur (le remettre dans staff et le supprimer de staff_gone)
app.post('/api/staff/restore/:id', async (req, res) => {
    try {
        const { password } = req.body;
        const adminPassword = process.env.ADMIN_PASSWORD;

        // Sécurisé avec process.env
        if (!adminPassword || password !== adminPassword) {
            return res.status(401).json({ success: false, message: "Mot de passe administrateur incorrect." });
        }

        const staffId = req.params.id;
        const goneDocRef = db.collection('sofitel_cotonou_staff_gone').doc(staffId);
        const goneDoc = await goneDocRef.get();

        if (!goneDoc.exists) {
            return res.status(404).json({ success: false, message: "Utilisateur introuvable dans les archives." });
        }

        const staffData = goneDoc.data();
        staffData.statut = 'active';
        delete staffData.deletedAt;

        await db.collection('sofitel_cotonou_staff').doc(staffId).set(staffData);
        await goneDocRef.delete();

        res.json({ success: true, message: "Utilisateur restauré avec succès." });
    } catch (error) {
        console.error("Erreur restore:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// 3. Supprimer définitivement un utilisateur de staff_gone
app.delete('/api/staff-gone/:id', async (req, res) => {
    try {
        const { password } = req.body;
        const adminPassword = process.env.ADMIN_PASSWORD;

        // Sécurisé avec process.env
        if (!adminPassword || password !== adminPassword) {
            return res.status(401).json({ success: false, message: "Mot de passe administrateur incorrect." });
        }

        const staffId = req.params.id;
        await db.collection('sofitel_cotonou_staff_gone').doc(staffId).delete();

        res.json({ success: true, message: "Utilisateur supprimé définitivement." });
    } catch (error) {
        console.error("Erreur permanent delete:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
    console.log(`Serveur backend SAP démarré sur le port ${PORT}`);
});