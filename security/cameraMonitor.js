const { execFile } = require("child_process");

async function checkCamera() {
    return new Promise((resolve) => {
        const script = `
$devices = Get-PnpDevice -PresentOnly |
Where-Object {
    $_.Class -eq "Camera" -or
    $_.Class -eq "Image" -or
    $_.FriendlyName -match "Camera" -or
    $_.FriendlyName -match "Webcam"
} |
Select-Object FriendlyName, Manufacturer, Status, Class

$devices | ConvertTo-Json -Compress
`;

        execFile(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
            { windowsHide: true, timeout: 10000 },
            (error, stdout, stderr) => {
                if (error) {
                    console.error("Camera detection error:", error.message);
                    resolve({ passed: false, message: "Unable to detect camera devices." });
                    return;
                }

                try {
                    const output = stdout.trim();

                    if (!output) {
                        resolve({ passed: false, message: "No camera detected." });
                        return;
                    }

                    let devices = JSON.parse(output);
                    if (!Array.isArray(devices)) devices = [devices];

                    const availableCameras = devices.filter(device => device.Status === "OK");

                    if (availableCameras.length === 0) {
                        resolve({ passed: false, message: "Camera detected but it is not working." });
                        return;
                    }

                    const internalKeywords = [
                        "integrated camera",
                        "integrated webcam",
                        "integrated",
                        "built-in camera",
                        "built in camera",
                        "built-in webcam",
                        "built in webcam",
                        "internal camera",
                        "internal webcam",
                        "laptop camera",
                        "laptop webcam",
                        "front camera",
                        "hd camera",
                        "hd webcam",
                        "webcam"
                    ];

                    const externalKeywords = [
                        "usb camera",
                        "usb webcam",
                        "external camera",
                        "external webcam",
                        "logitech",
                        "razer",
                        "elgato",
                        "lifecam",
                        "brio",
                        "c920",
                        "c922",
                        "c930",
                        "c925",
                        "streamcam",
                        "obs virtual camera",
                        "virtual camera"
                    ];

                    const classified = availableCameras.map(device => {
                        const name = String(device.FriendlyName || "");
                        const manufacturer = String(device.Manufacturer || "");
                        const text = `${name} ${manufacturer}`.toLowerCase();

                        const isExternal = externalKeywords.some(keyword => text.includes(keyword));
                        const isInternal = internalKeywords.some(keyword => text.includes(keyword));

                        return {
                            name,
                            manufacturer,
                            status: device.Status,
                            class: device.Class,
                            isExternal,
                            isInternal
                        };
                    });

                    const virtualCamera = classified.find(camera =>
                        camera.name.toLowerCase().includes("virtual camera")
                    );

                    if (virtualCamera) {
                        resolve({
                            passed: false,
                            message: "Virtual camera detected.",
                            cameras: classified
                        });
                        return;
                    }

                    const externalCamera = classified.find(camera => camera.isExternal);

                    if (externalCamera) {
                        resolve({
                            passed: false,
                            message: "External camera detected: " + externalCamera.name,
                            cameras: classified
                        });
                        return;
                    }

                    const internalCamera = classified.find(camera => camera.isInternal);

                    if (internalCamera) {
                        resolve({
                            passed: true,
                            message: "Internal camera detected: " + internalCamera.name,
                            camera: internalCamera,
                            cameras: classified
                        });
                        return;
                    }

                    resolve({
                        passed: false,
                        message: "Camera detected, but it could not be verified as an internal camera.",
                        cameras: classified
                    });
                } catch (parseError) {
                    console.error("Unable to parse camera information:", parseError);
                    resolve({
                        passed: false,
                        message: "Unable to read camera information."
                    });
                }
            }
        );
    });
}

module.exports = { checkCamera };