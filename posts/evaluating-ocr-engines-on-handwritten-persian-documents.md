---
title: "Evaluating OCR Engines on Handwritten Persian Documents"
date: 2026-10-20T14:18:26.000Z
excerpt: "An initial assessment of handwritten Persian documents for an OCR pilot, featuring early benchmark results across Gemini, RapidOCR, and Tesseract."
tags: ["ocr","persian","benchmarking","llm"]
source_lang: en
---

The contact sheet is at `labeling/preview.png` (11 documents, 5 random crops each, titled with the document name and line count). Nothing was sent anywhere, and I haven't started Step 2.

## Document Guesses

The crops are unfiltered random picks, so many are fragments. The letter counts come from the older model-generated labels, not ground truth.

| # | Lines | Guess |
|---|---|---|
| 1 | 6579 | Handwritten Persian, accounting. Many number and fragment crops. Persian/Latin letters in old labels: 140818/230. |
| 2 | 5471 | Handwritten Persian, faint ink, lots of numbers. 103678/556. |
| 3 | 4459 | Handwritten equations and numbers with Latin symbols (H₃L₃, D=1). A poor fit for Persian text. 44008/5322. |
| 4 | 1467 | Gold. Handwritten math: formulas and symbol blobs, little Persian prose. 12671/5951. |
| 5 | 1151 | Clean handwritten Persian, heading style. The best-looking candidate. 49989/3. |
| 6 | 596 | Mixed: handwritten Persian, English handwriting, and printed «Month/Date» form labels. 20099/7502. |
| 7 | 580 | Gold. Handwritten Persian. My 5 samples were all fragments and digits, so I can't say more. 24333/188. |
| 8 | 547 | Handwritten Persian, small and sparse, many near-empty crops. 17146/9. |
| 9 | 287 | Gold. Clean handwritten Persian in several ink colours. The best gold document. 15102/1. |
| 10 | 276 | Mixed: handwritten digits in grey table cells and a printed-looking Persian line. The weakest candidate. 4162/431. |
| 11 | 215 | Gold. Handwritten Persian words plus printed English labels («Month:», «Year:»). 5804/57. |

## Pilot Document Count

Gold documents are excluded from the pilot, leaving the non-gold candidates: 1, 2, 3, 5, 6, 8, and 10. That makes exactly 7, so picking 6 documents means taking at least one of the weaker ones (3, 6, or 10). I'd recommend 1, 2, 5, and 8, followed by 6 and 3.

## Partial DastKhat Table

This table covers the images Gemini completed and the corresponding images for the other engines. The Gemini cache holds 21 images, not 19: the last resume run finished two more before stopping. Only `rapidocr-ar` and `tesseract-fas` have DastKhat caches. The Qwen, Gemma, and Qwen3-VL-8B runs were never started. Scores strip the printed caption «فضای نوشتن» from every engine's output.

| Engine | Images | CER | WER | Word acc | s/image |
|---|---|---|---|---|---|
| gemini (2.5-flash) | 21 | 0.0830 | 0.2734 | 72.7% | 23.05* |
| rapidocr-ar (control) | 21 | 0.8199 | 0.9856 | 1.4% | 1.67 |
| tesseract-fas (control) | 21 | 0.9068 | 0.9928 | 0.7% | 0.15 |

\*Gemini's timing includes retry waits, so it overstates actual latency.

## Why the Gemini Run Paused

It hit HTTP 429 (Too Many Requests) and exhausted its 5 retries (with backoffs of 20–90 s). A single test call a few minutes later returned 200, which suggests a per-minute rate burst rather than an exhausted daily quota. I didn't capture the 429 response body, so I can't confirm that for sure. It also ran into a 503 earlier. The resumed run with 6-second pacing was the process you interrupted, so it never got to run.

## Two Other Things

- **Ollama**: The server is down (connection refused), so the Gemma draft run for your labeling page cut off at 78 drafts. You have 127 labels. I haven't restarted anything yet.
- **Allowlist**: I'll cap the pilot at 100 lines per document. Let me know when the allowlist is ready and I'll kick off Step 2.
