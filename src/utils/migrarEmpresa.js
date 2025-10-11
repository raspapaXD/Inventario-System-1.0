// src/utils/migrarEmpresa.js
import { doc, setDoc, collection, getDocs, deleteDoc } from "firebase/firestore";
import { db } from "../../firebaseClient.js"; // si da error, prueba "../firebaseClient.js"

export async function migrateEmpresaDoc(empresaId) {
  try {
    const col = collection(db, "empresas", empresaId, "empresa");
    const snap = await getDocs(col);

    if (snap.empty) {
      console.log("⚠️ No hay subcolección 'empresa' en", empresaId);
      return;
    }

    const first = snap.docs[0];
    const data = first.data();

    await setDoc(
      doc(db, "empresas", empresaId),
      {
        ...data,
        suspended: false,
        actualizadoEn: new Date().toISOString(),
      },
      { merge: true }
    );

    // Borra documentos de la subcolección
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }

    console.log("✅ Migrado 'empresa' -> doc raíz para", empresaId);
  } catch (err) {
    console.error("❌ Error migrando empresa:", err);
  }
}
