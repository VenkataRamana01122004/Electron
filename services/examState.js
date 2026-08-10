let examRunning = false;
let examStartedAt = null;

function setExamRunning(value) {
    examRunning = Boolean(value);
    examStartedAt = examRunning ? Date.now() : null;
}

function isExamRunning() {
    return examRunning;
}

function getExamStartedAt() {
    return examStartedAt;
}

function endExam() {
    examRunning = false;
    examStartedAt = null;
}

module.exports = {
    setExamRunning,
    isExamRunning,
    getExamStartedAt,
    endExam
};