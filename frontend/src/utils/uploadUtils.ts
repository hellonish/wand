import { type ProfileFileType, type ProfileFileUploadResponse } from './api';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

function getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('token');
}

export function uploadFileXHR(
    file: File,
    type: ProfileFileType,
    additionalContext: string | undefined,
    onProgress: (pct: number) => void,
    onParsing: () => void,
): Promise<ProfileFileUploadResponse> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', type);
        if (additionalContext) formData.append('additional_context', additionalContext);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.upload.onload = () => onParsing();

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch { reject(new Error('Invalid response')); }
            } else {
                try {
                    const err = JSON.parse(xhr.responseText);
                    reject(new Error(err.detail || 'Upload failed'));
                } catch { reject(new Error('Upload failed')); }
            }
        };

        xhr.onerror = () => reject(new Error('Network error'));

        const token = getToken();
        xhr.open('POST', `${API_BASE}/api/profile/upload`);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
    });
}
