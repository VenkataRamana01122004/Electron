const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const { execFile } = require("child_process");
const path = require("path");

const { startProcessMonitoring, stopProcessMonitoring } = require("./security/processMonitor");
const { getDisplayInformation } = require("./security/displayMonitor");
const { getSystemInformation } = require("./security/systemInfo");
const { runSecurityChecks } = require("./security/securityCheck");
const { setExamRunning, isExamRunning, endExam } = require("./services/examState");
const {
    getBackgroundApplications
} = require("./security/backgroundApplications");

const EXAM_DURATION_MS = 0.5 * 60 * 1000;
const RECORDINGS_DIR = path.join(__dirname, "recordings");
// const ExamportalURL = "https://www.codechef.com/";
const ExamportalURL = "http://localhost:5173/";
const ROOM_VERIFICATION_PAGE = path.join(
    __dirname,
    "pages",
    "room-verification.html"
);
const SECURITY_PAGE = path.join(__dirname, "pages", "security-check.html");

let mainWindow = null;
let exitWindow = null;
let examCloseTimer = null;
let isQuitting = false;
let roomVerificationPassed = false;
let securityCheckPassed = false;
let altTabCount = 0;
let examLocked = false;

let returningToSecurity = false;
let handlingApplicationSwitch = false;
let navigatingToExamPortal = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1920,
        height: 1080,

        fullscreen: true,
        kiosk: true,

        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: false,

        alwaysOnTop: true,
        autoHideMenuBar: true,

        backgroundColor: "#ffffff",

        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            devTools: false
        }
    });

    // Force kiosk/fullscreen
    mainWindow.setKiosk(true);
    mainWindow.setFullScreen(true);

    // Open room verification first
mainWindow.loadFile(ROOM_VERIFICATION_PAGE);
    // mainWindow.loadFile(SECURITY_PAGE);


    mainWindow.webContents.setWindowOpenHandler(() => {
        console.log("Blocked new window");
        return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event, url) => {
        try {
            const parsedUrl = new URL(url);
            const hostname = parsedUrl.hostname.toLowerCase();
            const isCodeChef = hostname === "codechef.com" || hostname.endsWith(".codechef.com");

            if (isCodeChef) return;

            event.preventDefault();
            console.log("Blocked navigation:", url);
        } catch (error) {
            console.error("Invalid navigation:", url);
            event.preventDefault();
        }
    });


mainWindow.on("blur", async () => {

    /*
    ==========================================
    IGNORE BLUR WHILE APPLICATION IS EXITING
    ==========================================
    */

    if (isQuitting) {

        console.log(
            "Blur ignored - application is shutting down."
        );

        return;
    }


    /*
    ==========================================
    IGNORE OUR OWN NAVIGATION BLUR
    ==========================================
    */

    if (
        returningToSecurity ||
        handlingApplicationSwitch ||
        navigatingToExamPortal
    ) {
        return;
    }

    if (!isExamRunning()) {
        return;
    }


    /*
    ==========================================
    APPLICATION SWITCH DETECTED
    ==========================================
    */

    altTabCount++;

    console.log(
        `Application switch detected: ${altTabCount}/3`
    );


    sendSecurityEvent({
        type: "APPLICATION_SWITCH",
        count: altTabCount,
        timestamp: Date.now()
    });

    if (altTabCount >= 3) {
        lockExam("Maximum application switches exceeded");
    }

});

    mainWindow.on("focus", () => {
        sendSecurityEvent({
            type: "WINDOW_FOCUS",
            timestamp: Date.now()
        });
    });

    mainWindow.on("close", event => {

    if (!isQuitting) {

        event.preventDefault();

        console.log(
            "Electron exit attempt detected"
        );

        sendSecurityEvent({
            type: "EXIT_ATTEMPT",
            timestamp: Date.now()
        });

        lockExam(
            "Candidate attempted to exit the exam application"
        );

        return;
    }
});

    mainWindow.on("leave-full-screen", () => {
        sendSecurityEvent({
            type: "FULLSCREEN_EXIT",
            timestamp: Date.now()
        });

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setFullScreen(true);
        }
    });

    mainWindow.on("enter-full-screen", () => {
        console.log("Fullscreen enabled");
    });

    try {
        startProcessMonitoring(mainWindow);
        console.log("Process monitoring started");
    } catch (error) {
        console.error("Unable to start process monitoring:", error);
    }

    createExitButton();
}

function createExitButton() {
    exitWindow = new BrowserWindow({
        width: 310,
        height: 45,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: true,
        parent: mainWindow,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { box-sizing: border-box; }
body {
    margin: 0;
    padding: 0;
    display: flex;
    gap: 10px;
    width: 310px;
    height: 45px;
    background: transparent;
    overflow: hidden;
}
button {
    height: 45px;
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 13px;
    font-weight: bold;
    cursor: pointer;
}
#exitBtn {
    width: 150px;
    background: #dc2626;
}
#exitBtn:hover {
    background: #b91c1c;
}
</style>
</head>
<body>
<button id="exitBtn">Exit Application</button>
<script>
const exitBtn = document.getElementById("exitBtn");

exitBtn.addEventListener("click", async () => {
    console.log("Exit button clicked");

    try {
        const result = await window.electronAPI.exitApp();
        console.log("Exit result:", result);
    } catch (error) {
        console.error("Exit failed:", error);
    }
});
</script>
</body>
</html>
`;

    exitWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    positionExitButton();
    exitWindow.setAlwaysOnTop(true, "screen-saver");
    exitWindow.once("ready-to-show", showExitButton);
    showExitButton();
}

// function showExitButton() {
//     if (exitWindow && !exitWindow.isDestroyed()) {
//         exitWindow.show();
//         exitWindow.setAlwaysOnTop(true, "screen-saver");
//         positionExitButton();
//     }
// }

function showExitButton() {
    if (
        exitWindow &&
        !exitWindow.isDestroyed() &&
        mainWindow &&
        !mainWindow.isDestroyed()
    ) {
        if (!exitWindow.isVisible()) {
            exitWindow.showInactive();
        }

        exitWindow.setAlwaysOnTop(true, "screen-saver");
        positionExitButton();
    }
}

function hideExitButton() {
    if (exitWindow && !exitWindow.isDestroyed()) {
        exitWindow.hide();
    }

    // Hiding the always-on-top child can leave keyboard focus on that
    // window, preventing text fields in the exam renderer from receiving
    // input.
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        mainWindow.webContents.focus();
    }
}

function lockExam(reason) {

    if (examLocked) {
        return;
    }

    examLocked = true;

    securityCheckPassed = false;

    console.log("====================================");
    console.log("EXAM LOCKED");
    console.log("Reason:", reason);
    console.log("Alt+Tab count:", altTabCount);
    console.log("====================================");


    /*
    Send lock event to security-check.html
    */

    sendSecurityEvent({
        type: "EXAM_LOCKED",

        reason: reason,

        altTabCount: altTabCount,

        timestamp: Date.now()
    });

}

function positionExitButton() {
    if (!exitWindow || exitWindow.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) return;

    const bounds = mainWindow.getBounds();
    const buttonWidth = 310;
    const buttonHeight = 45;
    const margin = 20;

    exitWindow.setBounds({
        x: bounds.x + bounds.width - buttonWidth - margin,
        y: bounds.y + bounds.height - buttonHeight - margin,
        width: buttonWidth,
        height: buttonHeight
    });
}

function setupWindowEvents() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.on("move", positionExitButton);
    mainWindow.on("resize", positionExitButton);
}

function sendSecurityEvent(event) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("security-event", event);
    }
}

ipcMain.handle("room-verification:complete", async (event) => {
    if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event.sender !== mainWindow.webContents
    ) {
        return { success: false, message: "Invalid window" };
    }

    // Only accept the request from the room verification page
    try {
        const currentUrl = new URL(event.senderFrame.url);
        const currentPage = path.basename(
            decodeURIComponent(currentUrl.pathname)
        );

        if (currentPage !== "room-verification.html") {
            return {
                success: false,
                message: "Invalid verification page"
            };
        }
    } catch {
        return { success: false, message: "Invalid page URL" };
    }

    roomVerificationPassed = true;

    try {
        await mainWindow.loadFile(SECURITY_PAGE);

        return { success: true };
    } catch (error) {
        roomVerificationPassed = false;
        console.error("Unable to load security page:", error);

        return { success: false, message: error.message };
    }
});



ipcMain.handle(
    "security:run-checks",
    async () => {

        console.log(
            "===================================="
        );

        console.log(
            "STARTING SECURITY CHECKS"
        );

        console.log(
            "===================================="
        );


        try {

            const result =
                await runSecurityChecks();


            console.log(
                "Security check result:"
            );

            console.log(
                JSON.stringify(
                    result,
                    null,
                    2
                )
            );


            /*
            Never allow a locked exam
            to become passed.
            */

            if (examLocked) {

                securityCheckPassed = false;

            } else {

                securityCheckPassed =
                    result.passed === true;

            }


            sendSecurityEvent({

                type:
                    securityCheckPassed
                        ? "SECURITY_CHECK_PASSED"
                        : "SECURITY_CHECK_FAILED",

                timestamp: Date.now(),

                result

            });


            return result;


        } catch (error) {

            console.error(
                "Security check error:",
                error
            );


            securityCheckPassed = false;


            return {

                passed: false,

                results: [

                    {
                        id: "security",

                        name: "Security Check",

                        passed: false,

                        message:
                            error.message
                    }

                ]

            };

        }

    }
);

ipcMain.handle(
    "background-applications:get",
    async () => {

        try {

            return await getBackgroundApplications();

        } catch (error) {

            console.error(
                "Background application error:",
                error
            );

            return {

                success:
                    false,

                count:
                    0,

                applications:
                    [],

                error:
                    error.message
            };
        }
    }
);

ipcMain.handle("recording:save", async (_event, recording) => {
    if (!recording || typeof recording.data !== "string") {
        return { success: false, message: "Recording data is required." };
    }

    const safeName = String(recording.name || `recording-${Date.now()}.webm`)
        .replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(RECORDINGS_DIR, safeName);

    try {
        fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(recording.data, "base64"));
        return { success: true, filePath };
    } catch (error) {
        console.error("Recording save error:", error);
        return { success: false, message: error.message };
    }
});

// ipcMain.handle("navigation:load-codechef", async () => {
//     if (
//         !roomVerificationPassed ||
//     !securityCheckPassed ||
//     examLocked
// ) {
//         console.log("Security checks have not passed.");

//         return {
//             success: false,
//             message: "Security checks must pass before opening Exam."
//         };
//     }

//     if (!mainWindow || mainWindow.isDestroyed()) {
//         return {
//             success: false,
//             message: "Main window is unavailable."
//         };
//     }

//     try {
//         navigatingToExamPortal = true;

// // Keep the Exit Application button visible
// showExitButton();

// console.log("Loading Exam Portal...");
// await mainWindow.loadURL(ExamportalURL);

// // Show it again after navigation
// showExitButton();

// console.log("Exam Portal loaded.");

//         return {
//             success: true,
//             url: ExamportalURL
//         };
//     } catch (error) {
//         console.error("Unable to load CodeChef:", error);
//         showExitButton();

//         return {
//             success: false,
//             message: error.message
//         };
//     } finally {
//         navigatingToExamPortal = false;
//         showExitButton();
//     }
// });

ipcMain.handle("navigation:load-codechef", async () => {
    if (
        !roomVerificationPassed ||
        !securityCheckPassed ||
        examLocked
    ) {
        return {
            success: false,
            message: "Security checks must pass before opening Exam"
        };
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
        return {
            success: false,
            message: "Main window is unavailable."
        };
    }

    try {
        navigatingToExamPortal = true;
        showExitButton();

        await mainWindow.loadURL(ExamportalURL);

        showExitButton();
        navigatingToExamPortal = false;

        return {
            success: true,
            url: ExamportalURL
        };
    } catch (error) {
        showExitButton();

        return {
            success: false,
            message: error.message
        };
    } finally {
        navigatingToExamPortal = false;
        showExitButton();
    }
});

ipcMain.handle("system:end-process", async (event, processName) => {
    return new Promise(resolve => {
        if (!processName) {
            resolve({
                success: false,
                message: "Process name is required."
            });
            return;
        }

        const allowedProcesses = [
            "chrome.exe",
            "obs.exe",
            "obs64.exe",
            "teamviewer.exe",
            "anydesk.exe",
            "discord.exe",
            "wireshark.exe",
            "fiddler.exe",
            "charles.exe",
            "processhacker.exe"
        ];

        const normalizedName = String(processName).toLowerCase().trim();

        if (!allowedProcesses.includes(normalizedName)) {
            resolve({
                success: false,
                message: "This process cannot be terminated."
            });
            return;
        }

        execFile(
            "taskkill",
            ["/IM", normalizedName, "/F"],
            { windowsHide: true },
            (error, stdout, stderr) => {
                if (error) {
                    console.error("Unable to terminate process:", error.message);

                    resolve({
                        success: false,
                        message: `Unable to end ${normalizedName}.`
                    });
                    return;
                }

                console.log(`${normalizedName} terminated.`);

                resolve({
                    success: true,
                    message: `${normalizedName} ended successfully.`
                });
            }
        );
    });
});

ipcMain.handle(
    "application:exit",
    async () => {

        if (isExamRunning()) {
            hideExitButton();
            return {
                success: false,
                message: "Exit is disabled while an exam is active."
            };
        }

        console.log(
            "===================================="
        );

        console.log(
            "EXIT APPLICATION REQUESTED"
        );

        console.log(
            "===================================="
        );


        /*
        MUST BE FIRST
        */

        isQuitting = true;


        /*
        Stop application-switch handling
        */

        returningToSecurity = true;

        handlingApplicationSwitch = true;


        if (examCloseTimer) {

            clearTimeout(
                examCloseTimer
            );

            examCloseTimer = null;

        }


        try {

            endExam();

        } catch (error) {

            console.error(
                "endExam error:",
                error
            );

        }


        try {

            stopProcessMonitoring();

        } catch (error) {

            console.error(
                "stopProcessMonitoring error:",
                error
            );

        }


        if (
            exitWindow &&
            !exitWindow.isDestroyed()
        ) {

            try {

                exitWindow.destroy();

            } catch (error) {

                console.error(
                    "Exit window destroy error:",
                    error
                );

            }

        }


        exitWindow = null;


        if (
            mainWindow &&
            !mainWindow.isDestroyed()
        ) {

            try {

                mainWindow.destroy();

            } catch (error) {

                console.error(
                    "Main window destroy error:",
                    error
                );

            }

        }


        mainWindow = null;


        try {

            app.quit();

        } catch (error) {

            console.error(
                "app.quit error:",
                error
            );

        }


        return {
            success: true
        };

    }
);

// ipcMain.handle("exam:start", async () => {
//     console.log("Exam started.");

//     if (!securityCheckPassed) {
//         console.log("Exam cannot start.");

//         return {
//             success: false,
//             message: "Security checks have not passed."
//         };
//     }

//     setExamRunning(true);

//     if (examCloseTimer) {
//         clearTimeout(examCloseTimer);
//         examCloseTimer = null;
//     }

//     examCloseTimer = setTimeout(() => {
//         console.log("Exam time expired.");

//         isQuitting = true;
//         endExam();
//         stopProcessMonitoring();

//         if (exitWindow && !exitWindow.isDestroyed()) {
//             exitWindow.close();
//         }

//         if (mainWindow && !mainWindow.isDestroyed()) {
//             mainWindow.close();
//         }

//         app.quit();
//     }, EXAM_DURATION_MS);

//     return {
//         success: true,
//         timestamp: Date.now()
//     };
// });

ipcMain.handle("exam:start", async () => {
    console.log("Exam started.");

    if (!securityCheckPassed) {
        console.log("Exam cannot start.");

        return {
            success: false,
            message: "Security checks have not passed."
        };
    }

    setExamRunning(true);

    // The application cannot be exited while an exam is active.
    hideExitButton();

    if (examCloseTimer) {
        clearTimeout(examCloseTimer);
        examCloseTimer = null;
    }

    examCloseTimer = setTimeout(() => {
        console.log("Exam time expired.");

        isQuitting = true;

        endExam();
        stopProcessMonitoring();

        if (exitWindow && !exitWindow.isDestroyed()) {
            exitWindow.close();
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.close();
        }

        app.quit();
    }, EXAM_DURATION_MS);

    return {
        success: true,
        timestamp: Date.now()
    };
});

ipcMain.handle("exam:state", async () => {
    return {
        running: isExamRunning()
    };
});

ipcMain.handle("exam:stop", async () => {
    endExam();
    return { success: true };
});

ipcMain.handle("system:get-info", async () => {
    try {
        return await getSystemInformation();
    } catch (error) {
        console.error("System information error:", error);

        return {
            error: error.message
        };
    }
});

ipcMain.handle("display:get-info", async () => {
    try {
        return getDisplayInformation();
    } catch (error) {
        console.error("Display information error:", error);

        return {
            error: error.message
        };
    }
});

ipcMain.handle("exam:finish", async () => {
    console.log("Exam finished.");

    if (examCloseTimer) {
        clearTimeout(examCloseTimer);
        examCloseTimer = null;
    }

    endExam();
    isQuitting = true;
    stopProcessMonitoring();

    if (exitWindow && !exitWindow.isDestroyed()) {
        exitWindow.close();
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
    }

    app.quit();

    return { success: true };
});

ipcMain.handle("system:close-chrome", async () => {
    return new Promise(resolve => {
        execFile(
            "taskkill",
            ["/IM", "chrome.exe", "/F"],
            (error, stdout, stderr) => {
                if (error) {
                    console.log("Chrome was not running or could not be closed.");

                    resolve({
                        success: false,
                        message: "Chrome is not running."
                    });
                    return;
                }

                console.log("Chrome closed successfully.");

                resolve({
                    success: true,
                    message: "Chrome closed successfully."
                });
            }
        );
    });
});

app.whenReady().then(() => {
    console.log("Electron application started.");
    createWindow();
    setupWindowEvents();
});

app.on("before-quit", () => {
    console.log("Application shutting down.");

    isQuitting = true;

    if (examCloseTimer) {
        clearTimeout(examCloseTimer);
        examCloseTimer = null;
    }

    try {
        stopProcessMonitoring();
    } catch (error) {
        console.error(error);
    }
});

app.on("window-all-closed", () => {});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        setupWindowEvents();
    }
});

ipcMain.handle("navigation:show-exit", async () => {
    if (isExamRunning()) {
        hideExitButton();
        return {
            success: false,
            message: "Exit is disabled while an exam is active."
        };
    }

    showExitButton();
    return { success: true };
});

ipcMain.handle("navigation:hide-exit", async () => {
    hideExitButton();
    return { success: true };
});