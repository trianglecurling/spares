import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useAlert } from '../contexts/AlertContext';
import api from '../utils/api';
import Button from './Button';
import ChoiceInput, { type ChoiceOption } from './ChoiceInput';
import FormCheckbox from './FormCheckbox';
import FormField from './FormField';
import Modal from './Modal';

export type ManagedFile = {
  id: number;
  originalFilename: string;
  displayName: string | null;
  description: string | null;
  mimeType: string;
  byteSize: number;
  visibility: 'public' | 'authenticated';
  suspectedOrphan: boolean;
  publicUrl: string;
  authenticatedUrl: string;
  thumbnailPublicUrl: string | null;
  thumbnailAuthenticatedUrl: string | null;
  createdAt: string;
};

const FILE_EDIT_VISIBILITY_OPTIONS: ChoiceOption<'public' | 'authenticated'>[] = [
  { value: 'public', label: 'Public' },
  { value: 'authenticated', label: 'Authenticated users only' },
];

const IMAGE_CONVERT_FORMAT_OPTIONS: ChoiceOption<'jpg' | 'png' | 'gif'>[] = [
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'gif', label: 'GIF' },
];

export type ContentFileEditModalProps = {
  isOpen: boolean;
  file: ManagedFile | null;
  onClose: () => void;
  onLibraryChanged?: () => void | Promise<void>;
  /**
   * Called after resize / crop-rotate / convert so callers can refresh embedded URLs (e.g. markdown `?v=` or new file id).
   * Invoked before `onClose`.
   */
  onImageBytesUpdated?: (payload: { sourceFileId: number; file: ManagedFile }) => void | Promise<void>;
};

function isImageFile(file: ManagedFile) {
  return file.mimeType.startsWith('image/');
}

export default function ContentFileEditModal({
  isOpen,
  file,
  onClose,
  onLibraryChanged,
  onImageBytesUpdated,
}: ContentFileEditModalProps) {
  const formFieldId = useId();
  const { showAlert } = useAlert();
  const [editingFile, setEditingFile] = useState<ManagedFile | null>(null);
  const [fileModalTab, setFileModalTab] = useState<'details' | 'resize' | 'cropRotate'>('details');
  const [fileEditForm, setFileEditForm] = useState({
    displayName: '',
    description: '',
    visibility: 'public' as 'public' | 'authenticated',
    suspectedOrphan: false,
  });
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [imageToolsBusy, setImageToolsBusy] = useState(false);
  const [imagePreviewVersion, setImagePreviewVersion] = useState(0);
  const [previewNaturalSize, setPreviewNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const [resizeMode, setResizeMode] = useState<'preset' | 'custom'>('preset');
  const [resizeForm, setResizeForm] = useState({
    preset: 'medium' as 'thumbnail' | 'small' | 'medium' | 'large',
    width: '',
    height: '',
    keepOriginal: true,
  });
  const [rotateDegrees, setRotateDegrees] = useState(0);
  const [convertFormat, setConvertFormat] = useState<'jpg' | 'png' | 'gif'>('jpg');
  const [cropSelection, setCropSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null
  );
  const cropDragStartRef = useRef<{ x: number; y: number } | null>(null);

  const notifyImageBytesUpdatedAndClose = async (sourceFileId: number, nextFile: ManagedFile) => {
    await onLibraryChanged?.();
    await onImageBytesUpdated?.({ sourceFileId, file: nextFile });
    onClose();
  };

  const applyOpeningState = (next: ManagedFile) => {
    setEditingFile(next);
    setFileModalTab('details');
    setFileEditForm({
      displayName: next.displayName ?? '',
      description: next.description ?? '',
      visibility: next.visibility,
      suspectedOrphan: next.suspectedOrphan,
    });
    setResizeMode('preset');
    setResizeForm({
      preset: 'medium',
      width: '',
      height: '',
      keepOriginal: true,
    });
    setRotateDegrees(0);
    setConvertFormat('jpg');
    setCropSelection(null);
    cropDragStartRef.current = null;
    setImagePreviewVersion((v) => v + 1);
    setPreviewNaturalSize(null);
  };

  useLayoutEffect(() => {
    if (!isOpen) {
      setEditingFile(null);
      setCropSelection(null);
      cropDragStartRef.current = null;
      return;
    }
    if (file) {
      applyOpeningState(file);
    }
  }, [isOpen, file]);

  const getImagePreviewUrl = (f: ManagedFile) => {
    const baseUrl = f.visibility === 'public' ? f.publicUrl : f.authenticatedUrl;
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}v=${imagePreviewVersion}`;
  };

  const toImageRelativePointFromClient = (clientX: number, clientY: number) => {
    const img = previewImageRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return { x, y, rect };
  };

  const handleCropMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (fileModalTab !== 'cropRotate' || imageToolsBusy) return;
    const point = toImageRelativePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    cropDragStartRef.current = { x: point.x, y: point.y };
    setCropSelection({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const handleCropMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const dragStart = cropDragStartRef.current;
    if (!dragStart) return;
    const point = toImageRelativePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    const left = Math.min(dragStart.x, point.x);
    const top = Math.min(dragStart.y, point.y);
    const width = Math.abs(point.x - dragStart.x);
    const height = Math.abs(point.y - dragStart.y);
    setCropSelection({ x: left, y: top, width, height });
  };

  const finalizeCropDrag = () => {
    cropDragStartRef.current = null;
    setCropSelection((current) => {
      if (!current) return null;
      if (current.width < 2 || current.height < 2) return null;
      return current;
    });
  };

  useEffect(() => {
    const handleWindowMouseMove = (event: MouseEvent) => {
      const dragStart = cropDragStartRef.current;
      if (!dragStart) return;
      const point = toImageRelativePointFromClient(event.clientX, event.clientY);
      if (!point) return;
      const left = Math.min(dragStart.x, point.x);
      const top = Math.min(dragStart.y, point.y);
      const width = Math.abs(point.x - dragStart.x);
      const height = Math.abs(point.y - dragStart.y);
      setCropSelection({ x: left, y: top, width, height });
    };

    const handleWindowMouseUp = () => {
      if (!cropDragStartRef.current) return;
      finalizeCropDrag();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, []);

  const handleSaveFileMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetFile = editingFile ?? file;
    if (!targetFile) return;
    setMetadataSaving(true);
    try {
      await api.patch(`/content/files/${targetFile.id}`, {
        displayName: fileEditForm.displayName.trim() || null,
        description: fileEditForm.description.trim() || null,
        visibility: fileEditForm.visibility,
        suspectedOrphan: fileEditForm.suspectedOrphan,
      });
      showAlert('File updated', 'success');
      await onLibraryChanged?.();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to update file', 'error');
    } finally {
      setMetadataSaving(false);
    }
  };

  const handleResizeImage = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetFile = editingFile ?? file;
    if (!targetFile) return;
    if (resizeMode === 'custom' && !resizeForm.width.trim() && !resizeForm.height.trim()) {
      showAlert('Provide width and/or height for custom resize', 'error');
      return;
    }
    setImageToolsBusy(true);
    try {
      const payload =
        resizeMode === 'preset'
          ? {
              preset: resizeForm.preset,
              keepOriginal: resizeForm.keepOriginal,
            }
          : {
              width: resizeForm.width.trim() ? Number.parseInt(resizeForm.width, 10) : undefined,
              height: resizeForm.height.trim() ? Number.parseInt(resizeForm.height, 10) : undefined,
              keepOriginal: resizeForm.keepOriginal,
            };
      const res = await api.post<ManagedFile>(`/content/files/${targetFile.id}/resize`, payload);
      showAlert('Image resized', 'success');
      await notifyImageBytesUpdatedAndClose(targetFile.id, res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to resize image', 'error');
    } finally {
      setImageToolsBusy(false);
    }
  };

  const handleApplyCropRotate = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetFile = editingFile ?? file;
    if (!targetFile) return;
    const img = previewImageRef.current;
    const natural = previewNaturalSize;
    if (!img || !natural) {
      showAlert('Image preview not ready', 'error');
      return;
    }
    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      showAlert('Image preview not ready', 'error');
      return;
    }
    const isQuarterTurn = Math.abs(rotateDegrees) % 180 !== 0;
    const previewScale = isQuarterTurn ? Math.min(rect.width / rect.height, rect.height / rect.width) : 1;
    const rotatedDisplayWidth = isQuarterTurn ? rect.height * previewScale : rect.width * previewScale;
    const rotatedDisplayHeight = isQuarterTurn ? rect.width * previewScale : rect.height * previewScale;
    const offsetX = (rect.width - rotatedDisplayWidth) / 2;
    const offsetY = (rect.height - rotatedDisplayHeight) / 2;
    const rotatedNaturalWidth = isQuarterTurn ? natural.height : natural.width;
    const rotatedNaturalHeight = isQuarterTurn ? natural.width : natural.height;

    const payload: {
      degrees: number;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    } = {
      degrees: rotateDegrees,
    };

    if (cropSelection && cropSelection.width >= 2 && cropSelection.height >= 2) {
      const normalizedLeft = Math.max(0, (cropSelection.x - offsetX) / rotatedDisplayWidth);
      const normalizedTop = Math.max(0, (cropSelection.y - offsetY) / rotatedDisplayHeight);
      const normalizedRight = Math.min(1, (cropSelection.x + cropSelection.width - offsetX) / rotatedDisplayWidth);
      const normalizedBottom = Math.min(1, (cropSelection.y + cropSelection.height - offsetY) / rotatedDisplayHeight);

      if (normalizedRight <= normalizedLeft || normalizedBottom <= normalizedTop) {
        showAlert('Crop rectangle is outside the transformed preview', 'error');
        return;
      }

      payload.x = Math.max(0, Math.floor(normalizedLeft * rotatedNaturalWidth));
      payload.y = Math.max(0, Math.floor(normalizedTop * rotatedNaturalHeight));
      payload.width = Math.max(1, Math.floor((normalizedRight - normalizedLeft) * rotatedNaturalWidth));
      payload.height = Math.max(1, Math.floor((normalizedBottom - normalizedTop) * rotatedNaturalHeight));
    }

    setImageToolsBusy(true);
    try {
      const res = await api.post<ManagedFile>(`/content/files/${targetFile.id}/crop-rotate`, payload);
      showAlert('Image transformed', 'success');
      await notifyImageBytesUpdatedAndClose(targetFile.id, res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to transform image', 'error');
    } finally {
      setImageToolsBusy(false);
    }
  };

  const getCropOutputDimensions = (): { width: number; height: number } | null => {
    const img = previewImageRef.current;
    if (!img || !previewNaturalSize || !cropSelection || cropSelection.width < 2 || cropSelection.height < 2) {
      return null;
    }
    const width = img.clientWidth || 0;
    const height = img.clientHeight || 0;
    if (width === 0 || height === 0) return null;

    const isQuarterTurn = Math.abs(rotateDegrees) % 180 !== 0;
    const previewScale = isQuarterTurn ? Math.min(width / height, height / width) : 1;
    const rotatedDisplayWidth = isQuarterTurn ? height * previewScale : width * previewScale;
    const rotatedDisplayHeight = isQuarterTurn ? width * previewScale : height * previewScale;
    const offsetX = (width - rotatedDisplayWidth) / 2;
    const offsetY = (height - rotatedDisplayHeight) / 2;
    const rotatedNaturalWidth = isQuarterTurn ? previewNaturalSize.height : previewNaturalSize.width;
    const rotatedNaturalHeight = isQuarterTurn ? previewNaturalSize.width : previewNaturalSize.height;

    const normalizedLeft = Math.max(0, (cropSelection.x - offsetX) / rotatedDisplayWidth);
    const normalizedTop = Math.max(0, (cropSelection.y - offsetY) / rotatedDisplayHeight);
    const normalizedRight = Math.min(1, (cropSelection.x + cropSelection.width - offsetX) / rotatedDisplayWidth);
    const normalizedBottom = Math.min(1, (cropSelection.y + cropSelection.height - offsetY) / rotatedDisplayHeight);

    if (normalizedRight <= normalizedLeft || normalizedBottom <= normalizedTop) return null;

    return {
      width: Math.max(1, Math.floor((normalizedRight - normalizedLeft) * rotatedNaturalWidth)),
      height: Math.max(1, Math.floor((normalizedBottom - normalizedTop) * rotatedNaturalHeight)),
    };
  };

  const getCropRotatePreviewTransform = (): CSSProperties | undefined => {
    if (fileModalTab !== 'cropRotate') return undefined;
    const img = previewImageRef.current;
    if (!img) {
      return rotateDegrees !== 0 ? { transform: `rotate(${rotateDegrees}deg)` } : undefined;
    }
    const width = img.clientWidth || 1;
    const height = img.clientHeight || 1;
    const isQuarterTurn = Math.abs(rotateDegrees) % 180 !== 0;
    const scale = isQuarterTurn ? Math.min(width / height, height / width) : 1;
    return {
      transform: `rotate(${rotateDegrees}deg) scale(${scale})`,
      transformOrigin: 'center center',
    };
  };

  const handleConvertImageType = async () => {
    const targetFile = editingFile ?? file;
    if (!targetFile) return;
    setImageToolsBusy(true);
    try {
      const res = await api.post<ManagedFile>(`/content/files/${targetFile.id}/convert`, {
        format: convertFormat,
      });
      showAlert('File type converted', 'success');
      await notifyImageBytesUpdatedAndClose(targetFile.id, res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showAlert(msg || 'Failed to convert file type', 'error');
    } finally {
      setImageToolsBusy(false);
    }
  };

  const cropOutputDimensions = getCropOutputDimensions();

  const workingFile = editingFile ?? (isOpen ? file : null);

  if (!isOpen || !workingFile) {
    return null;
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit file" size={isImageFile(workingFile) ? 'xl' : 'md'}>
      <div className="space-y-4">
        {isImageFile(workingFile) && (
          <div className="inline-flex rounded-lg border border-gray-200 p-1 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
            <button
              type="button"
              onClick={() => setFileModalTab('details')}
              className={`px-3 py-1.5 text-sm rounded-md ${fileModalTab === 'details' ? 'bg-white dark:bg-gray-800 text-primary-teal shadow-sm' : 'text-gray-600 dark:text-gray-400'}`}
            >
              File details
            </button>
            <button
              type="button"
              onClick={() => setFileModalTab('resize')}
              className={`px-3 py-1.5 text-sm rounded-md ${fileModalTab === 'resize' ? 'bg-white dark:bg-gray-800 text-primary-teal shadow-sm' : 'text-gray-600 dark:text-gray-400'}`}
            >
              Resize
            </button>
            <button
              type="button"
              onClick={() => {
                setFileModalTab('cropRotate');
                setRotateDegrees(0);
              }}
              className={`px-3 py-1.5 text-sm rounded-md ${fileModalTab === 'cropRotate' ? 'bg-white dark:bg-gray-800 text-primary-teal shadow-sm' : 'text-gray-600 dark:text-gray-400'}`}
            >
              Crop & Rotate
            </button>
          </div>
        )}

        {isImageFile(workingFile) && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900">
            <div className="text-xs text-gray-500 mb-2">
              {previewNaturalSize
                ? `Image: ${previewNaturalSize.width} × ${previewNaturalSize.height}`
                : 'Loading image preview...'}
            </div>
            <div
              className={`relative inline-block max-w-full overflow-hidden rounded ${fileModalTab === 'cropRotate' ? 'cursor-crosshair' : ''}`}
              onMouseDown={handleCropMouseDown}
              onMouseMove={handleCropMouseMove}
              onMouseUp={finalizeCropDrag}
            >
              <img
                ref={previewImageRef}
                src={getImagePreviewUrl(workingFile)}
                alt={workingFile.displayName || workingFile.originalFilename}
                className="max-h-[70vh] max-w-full rounded border border-gray-200 dark:border-gray-700 select-none"
                draggable={false}
                onLoad={(e) => {
                  const target = e.currentTarget;
                  setPreviewNaturalSize({
                    width: target.naturalWidth,
                    height: target.naturalHeight,
                  });
                }}
                style={getCropRotatePreviewTransform()}
              />
              {fileModalTab === 'cropRotate' && cropSelection && cropSelection.width > 0 && cropSelection.height > 0 && (
                <div
                  className="absolute border-2 border-primary-teal bg-primary-teal/15 pointer-events-none"
                  style={{
                    left: `${cropSelection.x}px`,
                    top: `${cropSelection.y}px`,
                    width: `${cropSelection.width}px`,
                    height: `${cropSelection.height}px`,
                  }}
                />
              )}
            </div>
          </div>
        )}

        {fileModalTab === 'resize' && isImageFile(workingFile) ? (
          <form onSubmit={handleResizeImage} className="space-y-4">
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setResizeMode('preset')}
                className={`px-3 py-2 text-sm rounded-md border ${
                  resizeMode === 'preset'
                    ? 'border-primary-teal text-primary-teal bg-primary-teal/10'
                    : 'border-gray-300 dark:border-gray-600'
                }`}
              >
                Presets
              </button>
              <button
                type="button"
                onClick={() => setResizeMode('custom')}
                className={`px-3 py-2 text-sm rounded-md border ${
                  resizeMode === 'custom'
                    ? 'border-primary-teal text-primary-teal bg-primary-teal/10'
                    : 'border-gray-300 dark:border-gray-600'
                }`}
              >
                Custom
              </button>
            </div>

            {resizeMode === 'preset' ? (
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { key: 'thumbnail', label: 'Thumbnail', value: '320px' },
                    { key: 'small', label: 'Small', value: '640px' },
                    { key: 'medium', label: 'Medium', value: '1024px' },
                    { key: 'large', label: 'Large', value: '1600px' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() =>
                      setResizeForm((f) => ({
                        ...f,
                        preset: preset.key,
                      }))
                    }
                    className={`text-left p-3 rounded-md border ${
                      resizeForm.preset === preset.key
                        ? 'border-primary-teal bg-primary-teal/10'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    <div className="font-medium text-sm">{preset.label}</div>
                    <div className="text-xs text-gray-500">{preset.value} max side</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <FormField label="Width" htmlFor={`${formFieldId}-resize-width`}>
                  <input
                    id={`${formFieldId}-resize-width`}
                    type="number"
                    min={1}
                    placeholder="Width"
                    value={resizeForm.width}
                    onChange={(e) => setResizeForm((f) => ({ ...f, width: e.target.value }))}
                    className="app-input"
                  />
                </FormField>
                <FormField label="Height" htmlFor={`${formFieldId}-resize-height`}>
                  <input
                    id={`${formFieldId}-resize-height`}
                    type="number"
                    min={1}
                    placeholder="Height"
                    value={resizeForm.height}
                    onChange={(e) => setResizeForm((f) => ({ ...f, height: e.target.value }))}
                    className="app-input"
                  />
                </FormField>
              </div>
            )}

            <FormCheckbox
              label="Keep original image"
              checked={resizeForm.keepOriginal}
              onChange={(checked) =>
                setResizeForm((f) => ({
                  ...f,
                  keepOriginal: checked,
                }))
              }
            />

            <Button type="submit" disabled={imageToolsBusy}>
              {imageToolsBusy ? 'Working...' : 'Apply resize'}
            </Button>
          </form>
        ) : fileModalTab === 'cropRotate' && isImageFile(workingFile) ? (
          <form onSubmit={handleApplyCropRotate} className="space-y-3 border border-gray-200 dark:border-gray-700 rounded p-3">
            <p className="font-medium">Crop & Rotate</p>
            <p className="text-xs text-gray-500">
              Choose rotation, optionally draw a crop rectangle on preview, then apply once.
            </p>
            <div className="flex gap-2">
              {[0, 90, 180, 270].map((deg) => (
                <button
                  key={deg}
                  type="button"
                  onClick={() => setRotateDegrees(deg)}
                  className={`px-3 py-2 rounded-md border text-sm ${
                    rotateDegrees === deg
                      ? 'border-primary-teal text-primary-teal bg-primary-teal/10'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                >
                  {deg}°
                </button>
              ))}
            </div>
            {cropOutputDimensions ? (
              <p className="text-xs text-gray-500">
                Crop output: {cropOutputDimensions.width} × {cropOutputDimensions.height} px
              </p>
            ) : (
              <p className="text-xs text-gray-500">No crop selection: rotation only will be applied.</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={imageToolsBusy}>
                {imageToolsBusy ? 'Working...' : 'Apply crop & rotate'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setCropSelection(null)} disabled={imageToolsBusy}>
                Clear cropping
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSaveFileMetadata} className="space-y-4">
            <FormField label="Display name" htmlFor={`${formFieldId}-edit-display-name`}>
              <input
                id={`${formFieldId}-edit-display-name`}
                type="text"
                value={fileEditForm.displayName}
                onChange={(e) => setFileEditForm((f) => ({ ...f, displayName: e.target.value }))}
                className="app-input"
              />
            </FormField>
            <FormField label="Description" htmlFor={`${formFieldId}-edit-description`}>
              <textarea
                id={`${formFieldId}-edit-description`}
                value={fileEditForm.description}
                onChange={(e) => setFileEditForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="app-input"
              />
            </FormField>
            <FormField label="Visibility" htmlFor={`${formFieldId}-edit-visibility`}>
              <ChoiceInput<'public' | 'authenticated'>
                inputId={`${formFieldId}-edit-visibility`}
                options={FILE_EDIT_VISIBILITY_OPTIONS}
                value={fileEditForm.visibility}
                onChange={(next) => {
                  if (next != null && !Array.isArray(next)) setFileEditForm((f) => ({ ...f, visibility: next }));
                }}
                listboxLabel="File visibility"
              />
            </FormField>
            {isImageFile(workingFile) && (
              <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <FormField label="Convert image type" htmlFor={`${formFieldId}-edit-convert-format`}>
                  <ChoiceInput<'jpg' | 'png' | 'gif'>
                    inputId={`${formFieldId}-edit-convert-format`}
                    options={IMAGE_CONVERT_FORMAT_OPTIONS}
                    value={convertFormat}
                    onChange={(next) => {
                      if (next != null && !Array.isArray(next)) setConvertFormat(next);
                    }}
                    listboxLabel="Convert image type"
                  />
                </FormField>
                <Button type="button" variant="secondary" onClick={handleConvertImageType} disabled={imageToolsBusy}>
                  {imageToolsBusy ? 'Working...' : 'Convert'}
                </Button>
              </div>
            )}
            <FormCheckbox
              label="Mark as suspected orphan"
              checked={fileEditForm.suspectedOrphan}
              onChange={(checked) => setFileEditForm((f) => ({ ...f, suspectedOrphan: checked }))}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={metadataSaving}>
                {metadataSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
