const fieldConfigs = [
    {
        id: 'first-name',
        required: true,
        rules: [
            {
                test: (value) => NAME_PATTERN.test(value), message: "Only letters, spaces, hyphens, and apostrophes allowed."
            },
            {
                test: (value) => value.length >= NAME_MIN_LENGTH, message: `Must be at least ${NAME_MIN_LENGTH} characters.`
            }
        ],
        hasSuccessState: false,
    },
    {
        id: 'middle-name',
        required: false,
        rules: [
            {
                test: (value) => NAME_PATTERN.test(value), message: "Only letters, spaces, hyphens, and apostrophes allowed."
            },
        ],
        hasSuccessState: false,
    },
    {
        id: 'last-name',
        required: true,
        rules: [
            {
                test: (value) => NAME_PATTERN.test(value), message: "Only letters, spaces, hyphens, and apostrophes allowed."
            },
            {
                test: (value) => value.length >= NAME_MIN_LENGTH, message: `Must be at least ${NAME_MIN_LENGTH} characters.`
            }
        ],
        hasSuccessState: false,
    },
    {
        id: 'suffix',
        required: false,
        rules: [
            {
                test: (value) => NAME_PATTERN.test(value), message: "Only letters, spaces, hyphens, and apostrophes allowed."
            },
        ],
        hasSuccessState: false,
    },
    {
        id: 'email',
        required: true,
        rules: [
            {
                test: (value) => EMAIL_PATTERN.test(value), message: "Enter a valid email address (e.g. name@example.com)"
            }
        ],
        hasSuccessState: true,
        successMessage: "Email address is valid"
    },
    {
        id: 'phone',
        required: true,
        rules: [
            {
                test: (value) => PH_MOBILE_PATTERN.test(value.replace(/[\s-]/g, '')), message: "Enter a valid mobile number (e.g. 09XXXXXXXXX)"
            }
        ],
        hasSuccessState: true,
        successMessage: "Phone number is valid"
    },
    {
        id: 'service-type',
        required: true,
        rules: [],
        hasSuccessState: false,
    },
    {
        id: 'appointment-date',
        required: true,
        rules: [
            {
                test: (value) => new Date(value) >= new Date(new Date().toDateString()), message: "Date cannot be in the past."
            }
        ],
        hasSuccessState: true,
        successMessage: "Appointment date is available"
    },
    {
        id: 'time-slot',
        required: true,
        rules: [],
        hasSuccessState: true,
        successMessage: "Time slot is available"
    }
]

const form = document.getElementById("booking-form");
const firstNameInput = document.getElementById("first-name");
const firstNameError = document.getElementById("first-name-error");
const firstNameErrorText = document.querySelector('#first-name-error .error-text');

const NAME_MIN_LENGTH = 2;
const NAME_PATTERN = /^[A-Za-z\s'-]+$/;
const EMAIL_PATTERN = /^[a-zA-Z0-9_+-]+(\.[a-zA-Z0-9_+-]+)*@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;
const PH_MOBILE_PATTERN = /^(09|\+639)\d{9}$/;

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
    firstNameErrorText.textContent = message;
    firstNameError.hidden = false;
    return false;
}

function clearFirstNameError() {
    firstNameInput.classList.remove('error');
    firstNameInput.removeAttribute('aria-invalid');
    firstNameErrorText.textContent = '';
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