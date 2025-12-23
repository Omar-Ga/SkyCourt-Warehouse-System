import { useEffect, useRef } from 'react';

type PrintableBarcodeProps = {
  barcodeValue: string;
  isOpen: boolean;
  onClose: () => void;
};

export const PrintableBarcode = ({ barcodeValue, isOpen, onClose }: PrintableBarcodeProps) => {
  const barcodeUrl = `/api/backup/barcode/${barcodeValue}`;
  const printStarted = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      printStarted.current = false;
      return;
    }

    if (isOpen && !printStarted.current) {
      printStarted.current = true;

      // Fetch the barcode data first
      fetch(`/api/items/generate-barcode/${barcodeValue}`)
        .then(response => {
          if (!response.ok) {
            throw new Error('Failed to fetch barcode data');
          }
          return response.json();
        })
        .then(data => {
          if (!data.imageData) {
            throw new Error('Invalid barcode data received');
          }

          const imageUrl = `data:image/${data.imageFormat};base64,${data.imageData}`;

          // Now create the iframe and print
          const iframe = document.createElement('iframe');
          iframe.style.position = 'absolute';
          iframe.style.width = '0';
          iframe.style.height = '0';
          iframe.style.border = '0';
          document.body.appendChild(iframe);

          const doc = iframe.contentWindow?.document;
          if (doc) {
            doc.open();
            doc.write(`
              <html>
                <head>
                  <title>Print Barcode</title>
                  <style>
                    @page { size: 50mm 25mm; margin: 0; }
                    body { margin: 0; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100%; }
                    .printable-area { width: 50mm; height: 25mm; display: flex; flex-direction: column; justify-content: center; align-items: center; box-sizing: border-box; padding: 2mm; }
                    .printable-area img { width: 100%; height: 100%; object-fit: fill; }
                  </style>
                </head>
                <body>
                  <div class="printable-area">
                    <img src="${imageUrl}" alt="Barcode for ${barcodeValue}" />
                  </div>
                </body>
              </html>
            `);
            doc.close();

            const printAndCleanup = () => {
              if (iframe.contentWindow) {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
              }
              if (iframe.parentNode) {
                iframe.parentNode.removeChild(iframe);
              }
              onClose();
            };

            const printImage = doc.querySelector('img');
            if (printImage) {
              if (printImage.complete) {
                setTimeout(printAndCleanup, 100); // Give a slight delay for rendering
              } else {
                printImage.onload = printAndCleanup;
                printImage.onerror = () => {
                  console.error("Failed to load image for printing.");
                  printAndCleanup();
                };
              }
            } else {
              printAndCleanup();
            }
          }
        })
        .catch(error => {
          console.error("Error preparing barcode for print:", error);
          onClose(); // Close the modal on error
        });
    }
  }, [isOpen, onClose, barcodeValue, barcodeUrl]);

  return null;
};
