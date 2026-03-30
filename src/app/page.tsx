"use client";

import { useState, useRef, useCallback } from "react";
import Image from "next/image";

type EnhancementType = "denoise" | "sharpen" | "color";

export default function Home() {
  const [image, setImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [scale, setScale] = useState<2 | 4>(2);
  const [enhancements, setEnhancements] = useState<EnhancementType[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleFile = (file: File) => {
    setError(null);
    setProcessedImage(null);
    setShowComparison(false);

    // Validate file type
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Please upload a JPG, PNG, or WebP image.");
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError("File size must be less than 10MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      setImage(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const toggleEnhancement = (type: EnhancementType) => {
    setEnhancements((prev) =>
      prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type]
    );
  };

  const processImage = async () => {
    if (!image || !canvasRef.current) return;

    setIsProcessing(true);
    setProgress(0);
    setError(null);

    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context not available");

      // Load image
      setProgress(10);
      const img = new window.Image();
      img.src = image;
      await new Promise((resolve) => {
        img.onload = resolve;
      });

      // Calculate new dimensions
      const newWidth = img.width * scale;
      const newHeight = img.height * scale;

      // Check for memory issues (max 8192px)
      if (newWidth > 8192 || newHeight > 8192) {
        throw new Error("Image too large after upscaling. Please use a smaller image.");
      }

      canvas.width = newWidth;
      canvas.height = newHeight;

      setProgress(30);

      // Draw scaled image
      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      setProgress(50);

      // Apply enhancements
      const imageData = ctx.getImageData(0, 0, newWidth, newHeight);
      const data = imageData.data;

      if (enhancements.includes("denoise")) {
        // Simple denoise using blur simulation
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = newWidth;
        tempCanvas.height = newHeight;
        const tempCtx = tempCanvas.getContext("2d")!;
        tempCtx.filter = "blur(1px)";
        tempCtx.drawImage(canvas, 0, 0);
        ctx.filter = "none";
        ctx.globalAlpha = 0.5;
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.globalAlpha = 1;
      }

      setProgress(70);

      if (enhancements.includes("sharpen")) {
        // Simple sharpening using contrast adjustment
        ctx.filter = "contrast(1.2)";
        ctx.drawImage(canvas, 0, 0);
        ctx.filter = "none";
      }

      setProgress(85);

      if (enhancements.includes("color")) {
        // Color enhancement using saturation
        ctx.filter = "saturate(1.3)";
        ctx.drawImage(canvas, 0, 0);
        ctx.filter = "none";
      }

      setProgress(95);

      // Get processed image
      const processed = canvas.toDataURL("image/png", 1.0);
      setProcessedImage(processed);
      setShowComparison(true);

      setProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadImage = () => {
    if (!processedImage) return;

    const link = document.createElement("a");
    link.href = processedImage;
    link.download = `enhanced-${scale}x.png`;
    link.click();
  };

  const reset = () => {
    setImage(null);
    setProcessedImage(null);
    setShowComparison(false);
    setEnhancements([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Image Enlargement & Enhancement
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            AI-powered image enhancement in your browser
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Upload Area */}
        {!image && (
          <div
            className={`
              border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
              transition-all duration-200
              ${isDragging 
                ? "border-blue-500 bg-blue-50" 
                : "border-gray-300 hover:border-gray-400 bg-white"
              }
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="text-5xl mb-4">📤</div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">
              Drop your image here
            </h2>
            <p className="text-gray-500">
              or click to browse — JPG, PNG, WebP up to 10MB
            </p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {/* Image Preview & Controls */}
        {image && !showComparison && (
          <div className="space-y-6">
            {/* Original Image */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-700 mb-4">Original Image</h2>
              <div className="relative rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center max-h-96">
                <img
                  src={image}
                  alt="Original"
                  className="max-w-full max-h-96 object-contain"
                />
              </div>
            </div>

            {/* Controls */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              {/* Scale Selection */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Upscale Factor
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="scale"
                      checked={scale === 2}
                      onChange={() => setScale(2)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-2 text-gray-700">2x</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="scale"
                      checked={scale === 4}
                      onChange={() => setScale(4)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-2 text-gray-700">4x</span>
                  </label>
                </div>
              </div>

              {/* Enhancement Selection */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Enhancements
                </label>
                <div className="flex flex-wrap gap-4">
                  {(["denoise", "sharpen", "color"] as EnhancementType[]).map((type) => (
                    <label
                      key={type}
                      className={`
                        flex items-center px-4 py-2 rounded-lg cursor-pointer transition-colors
                        ${enhancements.includes(type)
                          ? "bg-blue-100 text-blue-700 border border-blue-300"
                          : "bg-gray-50 text-gray-600 border border-gray-200 hover:border-gray-300"
                        }
                      `}
                    >
                      <input
                        type="checkbox"
                        checked={enhancements.includes(type)}
                        onChange={() => toggleEnhancement(type)}
                        className="w-4 h-4 text-blue-600 mr-2"
                      />
                      {type === "denoise" && "Denoise"}
                      {type === "sharpen" && "Sharpen"}
                      {type === "color" && "Color Enhancement"}
                    </label>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-4">
                <button
                  onClick={processImage}
                  disabled={isProcessing}
                  className={`
                    flex-1 py-3 px-6 rounded-lg font-medium text-white transition-colors
                    ${isProcessing
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-700"
                    }
                  `}
                >
                  {isProcessing ? "Processing..." : "Start Processing"}
                </button>
                <button
                  onClick={reset}
                  className="py-3 px-6 rounded-lg font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
              </div>

              {/* Progress */}
              {isProcessing && (
                <div className="mt-4">
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-sm text-gray-500 mt-2">{progress}% complete</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Comparison View */}
        {showComparison && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-700 mb-4">Before & After</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500 mb-2">Original</p>
                  <div className="rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                    <img
                      src={image!}
                      alt="Original"
                      className="max-w-full object-contain"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-2">Enhanced ({scale}x{enhancements.length > 0 && ` + ${enhancements.join(", ")}`})</p>
                  <div className="rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
                    <img
                      src={processedImage!}
                      alt="Enhanced"
                      className="max-w-full object-contain"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Download */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex gap-4">
                <button
                  onClick={downloadImage}
                  className="flex-1 py-3 px-6 rounded-lg font-medium text-white bg-green-600 hover:bg-green-700 transition-colors"
                >
                  Download Enhanced Image
                </button>
                <button
                  onClick={reset}
                  className="py-3 px-6 rounded-lg font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Start Over
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Hidden Canvas for Processing */}
        <canvas ref={canvasRef} className="hidden" />
      </main>

      {/* Footer */}
      <footer className="mt-12 text-center text-sm text-gray-400">
        <p>Images are processed locally in your browser. Nothing is uploaded to any server.</p>
      </footer>
    </div>
  );
}
