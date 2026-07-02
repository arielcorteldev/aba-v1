const form = document.getElementById("booking-form");
const firstNameInput = document.getElementById("first-name");
const firstNameError = document.getElementById("first-name-error");

const FIRST_NAME_MIN_LENGTH = 2;
const FIRST_NAME_PATTERN = /^[A-Za-z\s'-]+$/;

function validateFirstName() {
    const value = firstNameInput.value.trim();

    if (value === "") {
        return setFirstNameError("Please enter your first name");
    }
    if (!FIRST_NAME_PATTERN.test(value)) {
        return setFirstNameError("Only letters, spaces, hyphens, and apostrophes allowed.");
    }
    if (value.length < FIRST_NAME_MIN_LENGTH) {
        return setFirstNameError(`Must be at least ${FIRST_NAME_MIN_LENGTH} characters.`);
    }

    clearFirstNameError();
    return true;
}

function setFirstNameError(message) {
    firstNameInput.classList.add('error');
    firstNameInput.setAttribute('aria-invalid', 'true');
    firstNameError.textContent = message;
    firstNameError.hidden = false;
    return false;
}

function clearFirstNameError() {
    firstNameInput.classList.remove('error');
    firstNameInput.removeAttribute('aria-invalid');
    firstNameError.textContent = '';
    firstNameError.hidden = true;
}

form.addEventListener('submit', (e) => {
    e.preventDefault();

    const results = [
        validateFirstName(),
    ];

    const isValid = results.every((result) => result === true);

    if (isValid) {
        form.submit();
    }
})