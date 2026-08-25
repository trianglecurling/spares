import axios from 'axios';
import api from './api';
import type { ExpenseFieldError } from './expenseReports';

export function fieldErrorsFromUnknown(err: unknown): ExpenseFieldError[] {
  if (!axios.isAxiosError(err)) return [];
  const details = err.response?.data?.details;
  if (Array.isArray(details)) {
    return details.filter(
      (item): item is ExpenseFieldError =>
        item && typeof item === 'object' && typeof item.field === 'string' && typeof item.message === 'string'
    );
  }
  return [];
}

export async function postExpenseFormData(
  path: string,
  payload: Record<string, unknown>,
  files: Array<{ index: number; file: File }>,
  method: 'post' | 'patch' = 'post'
) {
  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  for (const item of files) {
    formData.append(`receiptFile_${item.index}`, item.file);
  }
  return api.request({
    url: path,
    method,
    data: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export async function openExpenseReceipt(path: string): Promise<void> {
  const response = await api.get(path, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(response.data);
  window.open(blobUrl, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
