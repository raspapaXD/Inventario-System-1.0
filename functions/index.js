// functions/index.js
// Node 20, CommonJS

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const MAX_DEVICES = 3;
const MAX_USERS_PER_EMPRESA = 3;

/* --------------------------- Helpers --------------------------- */

async function getUserEmpresaId(uid) {
  const snap = await db.doc(`usuarios/${uid}`).get();
  return snap.exists ? snap.get("empresaId") : null;
}

async function assertUserBelongsToEmpresa(uid, empresaId) {
  const userEmpresa = await getUserEmpresaId(uid);
  if (userEmpresa !== empresaId) {
    throw new HttpsError("permission-denied", "No perteneces a esta empresa.");
  }
}

async function assertEmpresaExists(empresaId) {
  const snap = await db.doc(`empresas/${empresaId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Empresa no existe.");
  return snap.data();
}

async function assertCallerIsOwnerOrAdmin(callerUid, empresaId) {
  const emp = await assertEmpresaExists(empresaId);
  const isOwner = emp.ownerUid === callerUid;
  const isAdmin =
    Array.isArray(emp.admins) && emp.admins.includes(callerUid);
  if (!isOwner && !isAdmin) {
    throw new HttpsError("permission-denied", "No autorizado.");
  }
  return emp;
}

/* ------------------ Dispositivos por empresa ------------------- */
/**
 * Registra un deviceId dentro de empresas/{empresaId}/dispositivos/{deviceId}
 * - Debe estar autenticado
 * - Su /usuarios/{uid}.empresaId debe coincidir
 * - Si el device existe, solo actualiza lastSeen (idempotente)
 * - Si no existe y ya hay 3, lanza resource-exhausted
 */
exports.registerDevice = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

  const { empresaId, deviceId } = request.data || {};
  if (!empresaId || !deviceId) {
    throw new HttpsError("invalid-argument", "Faltan empresaId o deviceId.");
  }

  await assertUserBelongsToEmpresa(uid, empresaId);

  const col = db.collection(`empresas/${empresaId}/dispositivos`);
  const deviceRef = col.doc(deviceId);
  const deviceSnap = await deviceRef.get();

  if (deviceSnap.exists) {
    await deviceRef.set(
      {
        uid,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ok: true, status: "already-registered" };
  }

  const countSnap = await col.select().get();
  const current = countSnap.size;
  if (current >= MAX_DEVICES) {
    throw new HttpsError(
      "resource-exhausted",
      `Límite de ${MAX_DEVICES} dispositivos alcanzado.`
    );
  }

  await deviceRef.set({
    uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeen: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true, status: "registered", total: current + 1 };
});

/**
 * Elimina el registro de un deviceId (p. ej., reemplazo de equipo)
 */
exports.unregisterDevice = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

  const { empresaId, deviceId } = request.data || {};
  if (!empresaId || !deviceId) {
    throw new HttpsError("invalid-argument", "Faltan empresaId o deviceId.");
  }

  await assertUserBelongsToEmpresa(uid, empresaId);
  await db.doc(`empresas/${empresaId}/dispositivos/${deviceId}`).delete();

  return { ok: true, status: "unregistered" };
});

/* ---------------- Suspender / Reactivar empresa ---------------- */
/**
 * setCompanySuspended
 * data: { empresaId: string, suspended: boolean }
 * Requiere que el caller sea owner/admin de la empresa.
 */
exports.setCompanySuspended = onCall({ cors: true }, async (req) => {
  const caller = req.auth;
  if (!caller) throw new HttpsError("unauthenticated", "No autenticado.");

  const { empresaId, suspended } = req.data || {};
  if (!empresaId || typeof suspended !== "boolean") {
    throw new HttpsError("invalid-argument", "Parámetros inválidos.");
  }

  await assertCallerIsOwnerOrAdmin(caller.uid, empresaId);

  await db.doc(`empresas/${empresaId}`).set(
    {
      suspended,
      suspendedUpdatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  // Opcional: revocar tokens de usuarios de esa empresa para expulsarlos al instante
  if (suspended) {
    const usersSnap = await db
      .collection("usuarios")
      .where("empresaId", "==", empresaId)
      .get();

    await Promise.all(
      usersSnap.docs.map(async (d) => {
        const uid = d.id;
        try {
          await admin.auth().revokeRefreshTokens(uid);
        } catch {
          // ignorar errores por usuario
        }
      })
    );
  }

  return { ok: true, suspended };
});

/* ------------------- Unirse a empresa (límite) ------------------ */
/**
 * joinCompany
 * data: { empresaId: string }
 * Reglas:
 *  - Autenticado
 *  - Empresa existe y no está suspendida
 *  - El usuario no debe pertenecer ya a otra empresa distinta
 *  - Límite de 3 usuarios por empresa
 */
exports.joinCompany = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "No autenticado.");

  const { empresaId } = req.data || {};
  if (!empresaId) {
    throw new HttpsError("invalid-argument", "Falta empresaId.");
  }

  const emp = await assertEmpresaExists(empresaId);
  if (emp.suspended === true) {
    throw new HttpsError("failed-precondition", "La empresa está suspendida.");
  }

  const userRef = db.doc(`usuarios/${uid}`);
  const userSnap = await userRef.get();
  if (userSnap.exists) {
    const current = userSnap.get("empresaId");
    if (current && current !== empresaId) {
      throw new HttpsError(
        "failed-precondition",
        "Tu cuenta ya está vinculada a otra empresa."
      );
    }
    if (current === empresaId) {
      return { ok: true, status: "already-in-company" };
    }
  }

  // Límite de usuarios por empresa
  const usersSnap = await db
    .collection("usuarios")
    .where("empresaId", "==", empresaId)
    .get();

  if (usersSnap.size >= MAX_USERS_PER_EMPRESA) {
    throw new HttpsError(
      "resource-exhausted",
      `Esta empresa ya alcanzó el límite de ${MAX_USERS_PER_EMPRESA} usuarios.`
    );
  }

  await userRef.set(
    {
      empresaId,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { ok: true, status: "joined" };
});
