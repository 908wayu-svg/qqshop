// ===== ค่าเชื่อมต่อ Firebase =====
// ค่าเหล่านี้เปิดเผยได้ ไม่ใช่ความลับ — ความปลอดภัยจริงอยู่ที่ไฟล์ firestore.rules

export const firebaseConfig = {
  apiKey: "AIzaSyClU0JJzyAYUmMSpANGctMVYTcKiVt_lbY",
  authDomain: "qqshop-ecc92.firebaseapp.com",
  projectId: "qqshop-ecc92",
  storageBucket: "qqshop-ecc92.firebasestorage.app",
  messagingSenderId: "882459509059",
  appId: "1:882459509059:web:e3920cec1fd7ce490caff6",
};

// ตรวจว่าตั้งค่าแล้วหรือยัง
export const isConfigured = !firebaseConfig.apiKey.startsWith("PASTE_");
