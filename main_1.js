const {
    app,
    BrowserWindow,
    ipcMain
} = require("electron");

const {
    execFile
} = require("child_process");

const path = require("path");

const {
    startProcessMonitoring,
    stopProcessMonitoring
} = require("./security/processMonitor");

const {
    getDisplayInformation
} = require("./security/displayMonitor");

const {
    getSystemInformation
} = require("./security/systemInfo");

const {
    runSecurityChecks
} = require("./security/securityCheck");

const {
    setExamRunning,
    isExamRunning,
    endExam
} = require("./services/examState");

const {
    getBackgroundApplications
} = require("./security/backgroundApplications");


/* =========================================================
   CONFIGURATION
========================================================= */

const ExamportalURL = "http://localhost:5173/";

const SECURITY_PAGE = path.join(
    __dirname,
    "pages",
    "security-check.html"
);

const MAX_APPLICATION_SWITCHES = 3;


/* =========================================================
   GLOBAL STATE
========================================================= */

let mainWindow = null;
let exitWindow = null;

let examCloseTimer = null;

let isQuitting = false;

let securityCheckPassed = false;

let altTabCount = 0;

let examLocked = false;

let currentExamPhase = "SECURITY";

let returningToSecurity = false;

let handlingApplicationSwitch = false;

let examSubmissionInProgress = false;

let processMonitoringStarted = false;

let examFinishInProgress = false;

let exitInProgress = false;


/* =========================================================
   CREATE MAIN WINDOW
========================================================= */

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

        alwaysOnTop: false,

        autoHideMenuBar: true,

        backgroundColor: "#ffffff",

        webPreferences: {

            preload: path.join(
                __dirname,
                "preload.js"
            ),

            contextIsolation: true,

            nodeIntegration: false,

            sandbox: false,

            /*
             * DevTools disabled.
             *
             * IMPORTANT:
             * This does NOT disable keyboard typing.
             */

            devTools: false
        }
    });


    /* =====================================================
       ELECTRON KIOSK / FULLSCREEN
       
       Electron controls fullscreen.
       React must NOT control browser fullscreen.
    ===================================================== */

    mainWindow.setKiosk(true);

    mainWindow.setFullScreen(true);


    /* =====================================================
       INITIAL SECURITY PAGE
    ===================================================== */

    mainWindow.loadFile(
        SECURITY_PAGE
    );


    /* =====================================================
       BLOCK NEW WINDOWS
    ===================================================== */

    mainWindow.webContents.setWindowOpenHandler(() => {

        console.log(
            "Blocked new window."
        );

        return {
            action: "deny"
        };
    });


    /* =====================================================
       BLOCK EXTERNAL NAVIGATION
    ===================================================== */

    mainWindow.webContents.on(
        "will-navigate",
        (event, url) => {

            try {

                const parsedUrl =
                    new URL(url);

                const hostname =
                    parsedUrl.hostname.toLowerCase();

                const allowed =
                    hostname === "localhost" ||
                    hostname === "127.0.0.1";

                if (allowed) {
                    return;
                }

                event.preventDefault();

                console.log(
                    "Blocked navigation:",
                    url
                );

            } catch (error) {

                console.error(
                    "Invalid navigation:",
                    url
                );

                event.preventDefault();
            }
        }
    );


    /* =====================================================
       CHILD WINDOWS
    ===================================================== */

    mainWindow.webContents.on(
        "did-create-window",
        (childWindow) => {

            console.log(
                "Closing unexpected child window."
            );

            try {
                childWindow.close();
            } catch (error) {
                console.error(
                    "Unable to close child window:",
                    error
                );
            }
        }
    );


    /* =====================================================
       MAIN WINDOW BLUR
    ===================================================== */

    mainWindow.on(
        "blur",
        () => {

            if (isQuitting) {
                return;
            }

            if (examSubmissionInProgress) {
                return;
            }

            if (!isExamRunning()) {
                return;
            }

            /*
             * Ignore blur if our exit button is focused.
             */

            if (
                exitWindow &&
                !exitWindow.isDestroyed() &&
                exitWindow.isFocused()
            ) {

                console.log(
                    "Blur ignored - exit window focused."
                );

                return;
            }

            /*
             * Ignore internal application changes.
             */

            if (
                handlingApplicationSwitch ||
                returningToSecurity
            ) {
                return;
            }

            altTabCount++;

            console.log(
                `Application switch detected: ${altTabCount}/${MAX_APPLICATION_SWITCHES}`
            );

            sendSecurityEvent({

                type: "APPLICATION_SWITCH",

                count: altTabCount,

                timestamp: Date.now()
            });


            if (
                altTabCount >=
                MAX_APPLICATION_SWITCHES
            ) {

                lockExam(
                    "Maximum application switches exceeded"
                );

                sendSecurityEvent({

                    type:
                        "ALT_TAB_LIMIT_EXCEEDED",

                    count:
                        altTabCount,

                    timestamp:
                        Date.now()
                });

                return;
            }


            sendSecurityEvent({

                type: "FOCUS_LOST",

                count: altTabCount,

                timestamp: Date.now()
            });
        }
    );


    /* =====================================================
       MAIN WINDOW FOCUS
    ===================================================== */

    mainWindow.on(
        "focus",
        () => {

            sendSecurityEvent({

                type:
                    "WINDOW_FOCUS",

                timestamp:
                    Date.now()
            });
        }
    );


    /* =====================================================
       CLOSE EVENT
    ===================================================== */

    mainWindow.on(
        "close",
        (event) => {

            if (!isQuitting) {

                event.preventDefault();

                console.log(
                    "Electron exit attempt detected."
                );

                sendSecurityEvent({

                    type:
                        "EXIT_ATTEMPT",

                    timestamp:
                        Date.now()
                });


                if (
                    isExamRunning() &&
                    !examSubmissionInProgress
                ) {

                    lockExam(
                        "Candidate attempted to exit the exam application"
                    );
                }

                return;
            }
        }
    );


    /* =====================================================
       ELECTRON FULLSCREEN EXIT
       
       THIS is the correct fullscreen detector.
       
       DO NOT use document.fullscreenElement in React
       for Electron kiosk fullscreen.
    ===================================================== */

    mainWindow.on(
        "leave-full-screen",
        () => {

            console.log(
                "Electron fullscreen was exited."
            );


            if (
                isQuitting ||
                examSubmissionInProgress ||
                !isExamRunning()
            ) {

                console.log(
                    "Fullscreen exit ignored."
                );

                return;
            }


            sendSecurityEvent({

                type:
                    "FULLSCREEN_EXIT",

                timestamp:
                    Date.now(),

                phase:
                    currentExamPhase
            });


            /*
             * Restore Electron fullscreen.
             *
             * NO DOM requestFullscreen().
             */

            setTimeout(
                () => {

                    if (
                        mainWindow &&
                        !mainWindow.isDestroyed() &&
                        !isQuitting &&
                        !examSubmissionInProgress &&
                        isExamRunning()
                    ) {

                        try {

                            mainWindow.setKiosk(
                                true
                            );

                            mainWindow.setFullScreen(
                                true
                            );

                        } catch (error) {

                            console.error(
                                "Unable to restore Electron fullscreen:",
                                error
                            );
                        }
                    }

                },
                100
            );
        }
    );


    /* =====================================================
       ELECTRON FULLSCREEN ENTER
    ===================================================== */

    mainWindow.on(
        "enter-full-screen",
        () => {

            console.log(
                "Electron fullscreen enabled."
            );

            positionExitButton();
        }
    );


    /* =====================================================
       RENDERER CRASH PROTECTION
    ===================================================== */

    mainWindow.webContents.on(
        "render-process-gone",
        (event, details) => {

            console.error(
                "Renderer process exited:",
                details
            );

            if (
                !isQuitting &&
                mainWindow &&
                !mainWindow.isDestroyed()
            ) {

                setTimeout(
                    () => {

                        if (
                            mainWindow &&
                            !mainWindow.isDestroyed() &&
                            !isQuitting
                        ) {

                            console.log(
                                "Reloading renderer..."
                            );

                            mainWindow.reload();
                        }

                    },
                    1000
                );
            }
        }
    );


    /* =====================================================
       UNRESPONSIVE
    ===================================================== */

    mainWindow.on(
        "unresponsive",
        () => {

            console.warn(
                "Main window became unresponsive."
            );
        }
    );


    mainWindow.on(
        "responsive",
        () => {

            console.log(
                "Main window responsive again."
            );
        }
    );


    /* =====================================================
       PROCESS MONITORING
    ===================================================== */

    try {

        if (!processMonitoringStarted) {

            startProcessMonitoring(
                mainWindow
            );

            processMonitoringStarted =
                true;

            console.log(
                "Process monitoring started."
            );
        }

    } catch (error) {

        console.error(
            "Unable to start process monitoring:",
            error
        );
    }


    /* =====================================================
       EXIT BUTTON
    ===================================================== */

    createExitButton();
}


/* =========================================================
   EXIT BUTTON
========================================================= */

function createExitButton() {

    exitWindow = new BrowserWindow({

        width: 170,

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

        /*
         * IMPORTANT:
         *
         * The exit overlay must NOT permanently steal
         * keyboard focus from React/code editors.
         */

        focusable: false,

        parent: mainWindow,

        webPreferences: {

            preload: path.join(
                __dirname,
                "preload.js"
            ),

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

* {
    box-sizing: border-box;
}

html,
body {

    margin: 0;

    padding: 0;

    width: 170px;

    height: 45px;

    background: transparent;

    overflow: hidden;
}

button {

    width: 170px;

    height: 45px;

    border: none;

    border-radius: 8px;

    color: white;

    background: #dc2626;

    font-size: 13px;

    font-weight: bold;

    cursor: pointer;
}

button:hover {

    background: #b91c1c;
}

</style>

</head>

<body>

<button id="exitBtn">
    Exit Application
</button>

<script>

const exitBtn =
    document.getElementById("exitBtn");

exitBtn.addEventListener(
    "click",
    async () => {

        try {

            await window.electronAPI.exitApp();

        } catch (error) {

            console.error(
                "Exit failed:",
                error
            );
        }
    }
);

</script>

</body>

</html>
`;


    exitWindow.loadURL(
        "data:text/html;charset=utf-8," +
        encodeURIComponent(html)
    );


    positionExitButton();


    exitWindow.setAlwaysOnTop(
        true,
        "screen-saver"
    );


    exitWindow.on(
        "closed",
        () => {

            exitWindow = null;
        }
    );
}


/* =========================================================
   POSITION EXIT BUTTON
========================================================= */

function positionExitButton() {

    if (
        !exitWindow ||
        exitWindow.isDestroyed() ||
        !mainWindow ||
        mainWindow.isDestroyed()
    ) {
        return;
    }


    const bounds =
        mainWindow.getBounds();


    const buttonWidth =
        170;

    const buttonHeight =
        45;

    const margin =
        20;


    exitWindow.setBounds({

        x:
            bounds.x +
            bounds.width -
            buttonWidth -
            margin,

        y:
            bounds.y +
            bounds.height -
            buttonHeight -
            margin,

        width:
            buttonWidth,

        height:
            buttonHeight
    });
}


/* =========================================================
   WINDOW POSITION EVENTS
========================================================= */

function setupWindowEvents() {

    if (
        !mainWindow ||
        mainWindow.isDestroyed()
    ) {
        return;
    }


    mainWindow.on(
        "move",
        positionExitButton
    );

    mainWindow.on(
        "resize",
        positionExitButton
    );

    mainWindow.on(
        "enter-full-screen",
        positionExitButton
    );

    mainWindow.on(
        "leave-full-screen",
        positionExitButton
    );
}


/* =========================================================
   SEND SECURITY EVENT
========================================================= */

function sendSecurityEvent(event) {

    if (
        mainWindow &&
        !mainWindow.isDestroyed()
    ) {

        try {

            mainWindow.webContents.send(
                "security-event",
                event
            );

        } catch (error) {

            console.error(
                "Unable to send security event:",
                error
            );
        }
    }
}


/* =========================================================
   LOCK EXAM
========================================================= */

function lockExam(reason) {

    if (examLocked) {
        return;
    }


    examLocked = true;

    securityCheckPassed = false;


    console.log(
        "===================================="
    );

    console.log(
        "EXAM LOCKED"
    );

    console.log(
        "Reason:",
        reason
    );

    console.log(
        "Alt+Tab count:",
        altTabCount
    );

    console.log(
        "Current phase:",
        currentExamPhase
    );

    console.log(
        "===================================="
    );


    sendSecurityEvent({

        type:
            "EXAM_LOCKED",

        reason:

            reason,

        altTabCount:
            altTabCount,

        phase:
            currentExamPhase,

        timestamp:
            Date.now()
    });
}


/* =========================================================
   SECURITY CHECK
========================================================= */

ipcMain.handle(
    "security:run-checks",
    async () => {

        try {

            const result =
                await runSecurityChecks();


            if (
                altTabCount >=
                MAX_APPLICATION_SWITCHES
            ) {

                lockExam(
                    "Maximum application switches exceeded"
                );

                securityCheckPassed =
                    false;


                sendSecurityEvent({

                    type:
                        "ALT_TAB_LIMIT_EXCEEDED",

                    altTabCount:
                        altTabCount,

                    timestamp:
                        Date.now(),

                    result:
                        result
                });


                return {

                    ...result,

                    passed:
                        false,

                    locked:
                        true,

                    reason:
                        "Maximum application switches exceeded",

                    altTabCount:
                        altTabCount
                };
            }


            if (examLocked) {

                securityCheckPassed =
                    false;

            } else {

                securityCheckPassed =
                    result.passed === true;
            }


            sendSecurityEvent({

                type:

                    securityCheckPassed

                        ? "SECURITY_CHECK_PASSED"

                        : "SECURITY_CHECK_FAILED",

                timestamp:
                    Date.now(),

                altTabCount:
                    altTabCount,

                result:
                    result
            });


            return {

                ...result,

                altTabCount:
                    altTabCount,

                locked:
                    examLocked
            };


        } catch (error) {

            console.error(
                "Security check error:",
                error
            );


            securityCheckPassed =
                false;


            sendSecurityEvent({

                type:
                    "SECURITY_CHECK_FAILED",

                timestamp:
                    Date.now(),

                error:
                    error.message
            });


            return {

                passed:
                    false,

                altTabCount:
                    altTabCount,

                locked:
                    examLocked,

                results: [

                    {

                        id:
                            "security",

                        name:
                            "Security Check",

                        passed:
                            false,

                        message:
                            error.message
                    }

                ]
            };
        }
    }
);


/* =========================================================
   LOAD REACT APPLICATION
========================================================= */

ipcMain.handle(
    "navigation:load-codechef",
    async () => {

        if (!securityCheckPassed) {

            return {

                success:
                    false,

                message:
                    "Security checks must pass before starting the exam."
            };
        }


        if (examLocked) {

            return {

                success:
                    false,

                message:
                    "Exam is locked."
            };
        }


        if (
            !mainWindow ||
            mainWindow.isDestroyed()
        ) {

            return {

                success:
                    false,

                message:
                    "Main window is unavailable."
            };
        }


        try {

            await mainWindow.loadURL(
                ExamportalURL
            );


            /*
             * Re-establish Electron fullscreen
             * after loading React.
             */

            mainWindow.setKiosk(
                true
            );

            mainWindow.setFullScreen(
                true
            );


            return {

                success:
                    true,

                url:
                    ExamportalURL
            };


        } catch (error) {

            console.error(
                "Unable to load exam portal:",
                error
            );


            return {

                success:
                    false,

                message:
                    error.message
            };
        }
    }
);


/* =========================================================
   START EXAM
========================================================= */

ipcMain.handle(
    "exam:start",
    async () => {

        if (!securityCheckPassed) {

            return {

                success:
                    false,

                message:
                    "Security checks have not passed."
            };
        }


        if (examLocked) {

            return {

                success:
                    false,

                message:
                    "Exam is locked."
            };
        }


        altTabCount =
            0;

        currentExamPhase =
            "BITS";

        examSubmissionInProgress =
            false;

        examFinishInProgress =
            false;

        returningToSecurity =
            false;

        handlingApplicationSwitch =
            false;


        setExamRunning(
            true
        );


        if (examCloseTimer) {

            clearTimeout(
                examCloseTimer
            );

            examCloseTimer =
                null;
        }


        /*
         * Ensure Electron fullscreen.
         */

        if (
            mainWindow &&
            !mainWindow.isDestroyed()
        ) {

            mainWindow.setKiosk(
                true
            );

            mainWindow.setFullScreen(
                true
            );
        }


        sendSecurityEvent({

            type:
                "EXAM_STARTED",

            phase:
                "BITS",

            timestamp:
                Date.now()
        });


        return {

            success:
                true,

            phase:
                currentExamPhase,

            timestamp:
                Date.now()
        };
    }
);


/* =========================================================
   EXAM PHASE
========================================================= */

ipcMain.handle(
    "exam:phase",
    async (
        event,
        phase
    ) => {

        const allowedPhases = [

            "SECURITY",

            "BITS",

            "CODING",

            "INTERVIEW",

            "COMPLETED"
        ];


        if (
            !allowedPhases.includes(
                phase
            )
        ) {

            return {

                success:
                    false,

                message:
                    "Invalid exam phase."
            };
        }


        currentExamPhase =
            phase;


        console.log(
            "EXAM PHASE:",
            currentExamPhase
        );


        sendSecurityEvent({

            type:
                "EXAM_PHASE_CHANGED",

            phase:
                currentExamPhase,

            timestamp:
                Date.now()
        });


        return {

            success:
                true,

            phase:
                currentExamPhase
        };
    }
);


/* =========================================================
   EXAM STATE
========================================================= */

ipcMain.handle(
    "exam:state",
    async () => {

        return {

            running:
                isExamRunning(),

            locked:
                examLocked,

            securityCheckPassed:
                securityCheckPassed,

            phase:
                currentExamPhase,

            altTabCount:
                altTabCount,

            submissionInProgress:
                examSubmissionInProgress
        };
    }
);


/* =========================================================
   BITS FINISHED
========================================================= */

ipcMain.handle(
    "exam:bits-finished",
    async () => {

        console.log(
            "BITS EXAM FINISHED -> CODING"
        );


        if (!isExamRunning()) {

            return {

                success:
                    false,

                message:
                    "Exam is not running."
            };
        }


        if (examLocked) {

            return {

                success:
                    false,

                message:
                    "Exam is locked."
            };
        }


        currentExamPhase =
            "CODING";


        securityCheckPassed =
            true;

        returningToSecurity =
            false;

        handlingApplicationSwitch =
            false;


        /*
         * Make absolutely sure Electron fullscreen
         * remains active for the coding page.
         */

        if (
            mainWindow &&
            !mainWindow.isDestroyed()
        ) {

            try {

                mainWindow.setKiosk(
                    true
                );

                mainWindow.setFullScreen(
                    true
                );

            } catch (error) {

                console.error(
                    "Unable to maintain fullscreen:",
                    error
                );
            }
        }


        sendSecurityEvent({

            type:
                "BITS_FINISHED",

            nextPhase:
                "CODING",

            timestamp:
                Date.now()
        });


        return {

            success:
                true,

            phase:
                "CODING"
        };
    }
);


/* =========================================================
   BACKGROUND APPLICATIONS
========================================================= */

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


/* =========================================================
   SYSTEM INFORMATION
========================================================= */

ipcMain.handle(
    "system:get-info",
    async () => {

        try {

            return await getSystemInformation();

        } catch (error) {

            return {

                error:
                    error.message
            };
        }
    }
);


/* =========================================================
   DISPLAY INFORMATION
========================================================= */

ipcMain.handle(
    "display:get-info",
    async () => {

        try {

            return getDisplayInformation();

        } catch (error) {

            return {

                error:
                    error.message
            };
        }
    }
);


/* =========================================================
   END PROCESS
========================================================= */

ipcMain.handle(
    "system:end-process",
    async (
        event,
        processName
    ) => {

        return new Promise(
            resolve => {

                if (!processName) {

                    resolve({

                        success:
                            false,

                        message:
                            "Process name is required."
                    });

                    return;
                }


                const allowedProcesses = [

                    "chrome.exe",

                    "brave.exe",

                    "msedge.exe",

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


                const normalizedName =
                    String(
                        processName
                    )
                    .toLowerCase()
                    .trim();


                if (
                    !allowedProcesses.includes(
                        normalizedName
                    )
                ) {

                    resolve({

                        success:
                            false,

                        message:
                            "This process cannot be terminated."
                    });

                    return;
                }


                execFile(

                    "taskkill",

                    [
                        "/IM",
                        normalizedName,
                        "/F"
                    ],

                    {
                        windowsHide:
                            true
                    },

                    (
                        error
                    ) => {

                        if (error) {

                            resolve({

                                success:
                                    false,

                                message:
                                    `Unable to end ${normalizedName}.`
                            });

                            return;
                        }


                        resolve({

                            success:
                                true,

                            message:
                                `${normalizedName} ended successfully.`
                        });
                    }
                );
            }
        );
    }
);


/* =========================================================
   CLOSE CHROME
========================================================= */

ipcMain.handle(
    "system:close-chrome",
    async () => {

        return new Promise(
            resolve => {

                execFile(

                    "taskkill",

                    [
                        "/IM",
                        "chrome.exe",
                        "/F"
                    ],

                    {
                        windowsHide:
                            true
                    },

                    (
                        error
                    ) => {

                        if (error) {

                            resolve({

                                success:
                                    false,

                                message:
                                    "Chrome is not running."
                            });

                            return;
                        }


                        resolve({

                            success:
                                true,

                            message:
                                "Chrome closed successfully."
                        });
                    }
                );
            }
        );
    }
);


/* =========================================================
   SUBMISSION START
========================================================= */

ipcMain.handle(
    "exam:submission-start",
    async () => {

        examSubmissionInProgress =
            true;

        returningToSecurity =
            true;

        handlingApplicationSwitch =
            true;


        if (examCloseTimer) {

            clearTimeout(
                examCloseTimer
            );

            examCloseTimer =
                null;
        }


        sendSecurityEvent({

            type:
                "EXAM_SUBMISSION_STARTED",

            phase:
                currentExamPhase,

            timestamp:
                Date.now()
        });


        return {

            success:
                true
        };
    }
);


/* =========================================================
   SUBMISSION COMPLETE
========================================================= */

ipcMain.handle(
    "exam:submission-complete",
    async () => {

        examSubmissionInProgress =
            false;

        returningToSecurity =
            false;

        handlingApplicationSwitch =
            false;

        currentExamPhase =
            "COMPLETED";


        sendSecurityEvent({

            type:
                "EXAM_SUBMISSION_COMPLETED",

            timestamp:
                Date.now()
        });


        return {

            success:
                true,

            phase:
                "COMPLETED"
        };
    }
);


/* =========================================================
   SUBMISSION FAILED
========================================================= */

ipcMain.handle(
    "exam:submission-failed",
    async (
        event,
        errorMessage
    ) => {

        examSubmissionInProgress =
            true;

        returningToSecurity =
            true;

        handlingApplicationSwitch =
            true;


        sendSecurityEvent({

            type:
                "EXAM_SUBMISSION_FAILED",

            error:
                errorMessage ||
                "Unknown submission error",

            timestamp:
                Date.now()
        });


        return {

            success:
                true,

            retryRequired:
                true
        };
    }
);


/* =========================================================
   FINISH EXAM
========================================================= */

ipcMain.handle(
    "exam:finish",
    async () => {

        if (examFinishInProgress) {

            return {

                success:
                    true,

                alreadyFinishing:
                    true
            };
        }


        examFinishInProgress =
            true;

        isQuitting =
            true;

        examSubmissionInProgress =
            true;

        returningToSecurity =
            true;

        handlingApplicationSwitch =
            true;


        if (examCloseTimer) {

            clearTimeout(
                examCloseTimer
            );

            examCloseTimer =
                null;
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

            if (processMonitoringStarted) {

                stopProcessMonitoring();

                processMonitoringStarted =
                    false;
            }

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
                console.error(error);
            }
        }


        exitWindow =
            null;


        if (
            mainWindow &&
            !mainWindow.isDestroyed()
        ) {

            try {
                mainWindow.destroy();
            } catch (error) {
                console.error(error);
            }
        }


        mainWindow =
            null;


        try {
            app.quit();
        } catch (error) {
            console.error(error);
        }


        return {

            success:
                true
        };
    }
);


/* =========================================================
   MANUAL EXIT
========================================================= */

ipcMain.handle(
    "application:exit",
    async () => {

        if (exitInProgress) {

            return {

                success:
                    true,

                alreadyExiting:
                    true
            };
        }


        exitInProgress =
            true;

        isQuitting =
            true;

        examSubmissionInProgress =
            true;

        returningToSecurity =
            true;

        handlingApplicationSwitch =
            true;


        if (examCloseTimer) {

            clearTimeout(
                examCloseTimer
            );

            examCloseTimer =
                null;
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

            if (processMonitoringStarted) {

                stopProcessMonitoring();

                processMonitoringStarted =
                    false;
            }

        } catch (error) {

            console.error(
                "Unable to stop monitoring:",
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
                console.error(error);
            }
        }


        exitWindow =
            null;


        if (
            mainWindow &&
            !mainWindow.isDestroyed()
        ) {

            try {
                mainWindow.destroy();
            } catch (error) {
                console.error(error);
            }
        }


        mainWindow =
            null;


        try {
            app.quit();
        } catch (error) {
            console.error(error);
        }


        return {

            success:
                true
        };
    }
);


/* =========================================================
   APP READY
========================================================= */

app.whenReady()
    .then(() => {

        console.log(
            "Electron application started."
        );

        createWindow();

        setupWindowEvents();
    });


/* =========================================================
   BEFORE QUIT
========================================================= */

app.on(
    "before-quit",
    () => {

        console.log(
            "Application shutting down."
        );


        isQuitting =
            true;

        examSubmissionInProgress =
            true;


        if (examCloseTimer) {

            clearTimeout(
                examCloseTimer
            );

            examCloseTimer =
                null;
        }


        try {

            if (processMonitoringStarted) {

                stopProcessMonitoring();

                processMonitoringStarted =
                    false;
            }

        } catch (error) {

            console.error(
                "Unable to stop process monitoring:",
                error
            );
        }
    }
);


/* =========================================================
   WINDOW ALL CLOSED
========================================================= */

app.on(
    "window-all-closed",
    () => {

        /*
         * Intentionally empty.
         */
    }
);


/* =========================================================
   ACTIVATE
========================================================= */

app.on(
    "activate",
    () => {

        if (
            BrowserWindow.getAllWindows()
                .length === 0
        ) {

            if (!isQuitting) {

                createWindow();

                setupWindowEvents();
            }
        }
    }
);