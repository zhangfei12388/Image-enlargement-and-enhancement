"use client";

import { useState, useRef, useCallback } from "react";

type EnhancementType = "denoise" | "sharpen" | "color";

export default function Home() {
  const [image, setImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [scale, setScale] = useState<2 | 4>(2);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const processImage = async () => {
    if (!image) return;

    setIsProcessing(true);
    setProgress(0);
    setError(null);
    setStatusMessage("Initializing AI processing...");

    try {
      setProgress(10);
      setStatusMessage("Converting image...");

      // Convert base64 to blob
      const response = await fetch(image);
      const blob = await response.blob();
      const file = new File([blob], "image.png", { type: "image/png" });

      setProgress(20);
      setStatusMessage("Sending to Cloudflare Workers AI...");

      // Call the Cloudflare Worker API
      const formData = new FormData();
      formData.append("image", file);
      formData.append("scale", scale.toString());

      setProgress(40);
      setStatusMessage("AI is upscaling and enhancing...");

      const apiUrl = "https://image-enhancement-worker.feiz45607-email.pages.dev/api/enhance";
      const result = await fetch(apiUrl, {
        method: "POST",
        body: formData,
      });

      setProgress(80);

      if (!result.ok) {
        const errorData = await result.json();
        throw new Error(errorData.error || "AI processing failed");
      }

      const data = await result.json();

      setProgress(95);
      setStatusMessage("Processing complete!");

      // The API returns base64 image data
      let imageData = data.image;
      
      // Handle case where image is returned as base64 without data URL prefix
      if (imageData && !imageData.startsWith("data:")) {
        imageData = `data:image/png;base64,${imageData}`;
      }

      setProcessedImage(imageData);
      setShowComparison(true);
      setProgress(100);
    } catch (err) {
      console.error("Processing error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "AI processing failed. Please try again."
      );
    } finally {
      setIsProcessing(false);
      setStatusMessage("");
    }
  };

  const downloadImage = () => {
    if (!processedImage) return;

    const link = document.createElement("a");
    link.href = processedImage;
    link.download = `ai-enhanced-${scale}x.png`;
    link.click();
  };

  const reset = () => {
    setImage(null);
    setProcessedImage(null);
    setShowComparison(false);
    setError(null);
    setStatusMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-900">
            🤖 AI Image Enlargement & Enhancement
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Powered by Cloudflare Workers AI — Real-ESRGAN Model
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
            <p className="text-red-400 text-xs mt-1">
              💡 Tip: Make sure the AI Worker is deployed first.
            </p>
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
              {/* AI Notice */}
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-blue-700 text-sm">
                  ✨ <strong>AI-Powered Enhancement:</strong> Uses Cloudflare Workers AI 
                  with Real-ESRGAN model for high-quality image upscaling and detail enhancement.
                </p>
              </div>

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
                    <span className="ml-2 text-gray-700">2x — 1080p → 2K</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="scale"
                      checked={scale === 4}
                      onChange={() => setScale(4)}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-2 text-gray-700">4x — 720p → 4K</span>
                  </label>
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
                      ? "bg-purple-400 cursor-not-allowed"
                      : "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                    }
                  `}
                >
                  {isProcessing ? "🤖 AI Processing..." : "🚀 Start AI Enhancement"}
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
                  <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-600 to-blue-600 transition-all duration-300 animate-pulse"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    {progress}% — {statusMessage}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Comparison View */}
        {showComparison && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-700 mb-4">
                🎉 AI Enhancement Complete!
              </h2>
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
                  <p className="text-sm text-gray-500 mb-2">
                    ✨ AI Enhanced ({scale}x)
                  </p>
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
                  className="flex-1 py-3 px-6 rounded-lg font-medium text-white bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 transition-colors"
                >
                  📥 Download Enhanced Image
                </button>
                <button
                  onClick={reset}
                  className="py-3 px-6 rounded-lg font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Process Another
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-12 text-center text-sm text-gray-400">
        <p>🤖 AI processing powered by Cloudflare Workers AI | Real-ESRGAN Model</p>
      </footer>
    </div>
  );
}
