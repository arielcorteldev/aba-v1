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
}