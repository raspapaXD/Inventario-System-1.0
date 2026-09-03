// src/services/imgbb.js
const API = "https://api.imgbb.com/1/upload";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]); // quitar el prefijo data:
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/**
 * Sube una imagen a ImgBB y retorna la URL pública.
 * @param {File} file
 * @returns {Promise<string>} url
 */
export async function uploadToImgBB(file) {
  const key = import.meta.env.VITE_IMGBB_API_KEY;
  if (!key) throw new Error("IMGBB_KEY_MISSING");

  // ImgBB acepta 'image' como base64
  const base64 = await fileToBase64(file);
  const form = new FormData();
  form.append("key", key);
  form.append("image", base64);

  const res = await fetch(API, { method: "POST", body: form });
  const json = await res.json();
  if (!json?.success) {
    throw new Error(json?.error?.message || "IMGBB_UPLOAD_FAILED");
  }
  return json.data.url; // también tienes display_url, thumb, etc.
}
