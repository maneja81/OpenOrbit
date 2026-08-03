import { ipcMain } from "electron";
import { synthesizeSpeech, transcribeAudio } from "../ai/provider";

export function registerVoiceHandlers() {
  ipcMain.handle("voice:transcribe", async (_event, base64Audio: string, format: string): Promise<string> => {
    if (typeof base64Audio !== "string" || base64Audio.length === 0) {
      throw new Error("voice:transcribe requires base64 audio data");
    }
    if (typeof format !== "string" || format.length === 0) {
      throw new Error("voice:transcribe requires an audio format");
    }
    return transcribeAudio(base64Audio, format);
  });

  ipcMain.handle(
    "voice:synthesize",
    async (_event, text: string): Promise<{ audio: string; format: string }> => {
      if (typeof text !== "string" || text.length === 0) {
        throw new Error("voice:synthesize requires text");
      }
      return synthesizeSpeech(text);
    }
  );
}
