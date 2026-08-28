import { google } from 'googleapis';

export class DriveConfigError extends Error {}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

function getConfig() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  const fileId = process.env.GOOGLE_DRIVE_FILE_ID?.trim();
  if (!email || !privateKey || !fileId) {
    throw new DriveConfigError(
      'Thiếu GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY / GOOGLE_DRIVE_FILE_ID trong biến môi trường.'
    );
  }
  return { email, privateKey, fileId };
}

function getDriveClient(email: string, privateKey: string) {
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Downloads the schedule file from Drive as .xlsx bytes.
 * Handles both a native Google Sheet (needs export) and an uploaded .xlsx
 * (downloaded as-is) — the file could be either depending on how it was
 * saved to Drive.
 */
export async function downloadScheduleXlsx(): Promise<Buffer> {
  const { email, privateKey, fileId } = getConfig();
  const drive = getDriveClient(email, privateKey);

  const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType' });
  const mimeType = meta.data.mimeType;

  if (mimeType === GOOGLE_SHEET_MIME) {
    const res = await drive.files.export(
      { fileId, mimeType: XLSX_MIME },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(res.data as ArrayBuffer);
  }

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data as ArrayBuffer);
}
