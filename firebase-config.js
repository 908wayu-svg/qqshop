// ===== ค่าเชื่อมต่อ Firebase =====
// นำค่าจาก Firebase Console > Project settings > Your apps > Web app มาวางแทนที่ด้านล่าง
// (ค่าเหล่านี้เปิดเผยได้ ไม่ใช่ความลับ — ความปลอดภัยจริงอยู่ที่ Firestore Rules)

export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

// ตรวจว่าตั้งค่าแล้วหรือยัง
export const isConfigured = !firebaseConfig.apiKey.startsWith("PASTE_");
