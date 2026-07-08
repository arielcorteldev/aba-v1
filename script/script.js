const NAME_MIN_LENGTH = 2;
const NAME_PATTERN = /^[A-Za-z\s'-]+$/;
const EMAIL_PATTERN =
  /^[a-zA-Z0-9_+-]+(\.[a-zA-Z0-9_+-]+)*@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;
const PH_MOBILE_PATTERN = /^(09|\+639)\d{9}$/;

const form = document.getElementById("booking-form");

const fieldConfigs = [
  {
    id: "first-name",
    required: true,
    requiredMessage: "Enter your first name.",
    rules: [
      {
        test: (value) => NAME_PATTERN.test(value),
        message: "Only letters, spaces, hyphens, and apostrophes allowed.",
      },
      {
        test: (value) => value.length >= NAME_MIN_LENGTH,
        message: `Must be at least ${NAME_MIN_LENGTH} characters.`,
      },
    ],
    hasSuccessState: false,
  },
  {
    id: "middle-name",
    required: false,
    rules: [
      {
        test: (value) => NAME_PATTERN.test(value),
        message: "Only letters, spaces, hyphens, and apostrophes allowed.",
      },
    ],
    hasSuccessState: false,
  },
  {
    id: "last-name",
    required: true,
    requiredMessage: "Enter your last name.",
    rules: [
      {
        test: (value) => NAME_PATTERN.test(value),
        message: "Only letters, spaces, hyphens, and apostrophes allowed.",
      },
      {
        test: (value) => value.length >= NAME_MIN_LENGTH,
        message: `Must be at least ${NAME_MIN_LENGTH} characters.`,
      },
    ],
    hasSuccessState: false,
  },
  {
    id: "suffix",
    required: false,
    rules: [
      {
        test: (value) => NAME_PATTERN.test(value),
        message: "Only letters, spaces, hyphens, and apostrophes allowed.",
      },
    ],
    hasSuccessState: false,
  },
  {
    id: "email",
    required: true,
    requiredMessage: "Enter your email address",
    rules: [
      {
        test: (value) => EMAIL_PATTERN.test(value),
        message: "Enter a valid email address (e.g. name@example.com)",
      },
    ],
    hasSuccessState: true,
    successMessage: "Email address is valid",
  },
  {
    id: "phone",
    required: true,
    requiredMessage: "Enter your phone number.",
    rules: [
      {
        test: (value) => PH_MOBILE_PATTERN.test(value.replace(/[\s-]/g, "")),
        message: "Enter a valid mobile number (e.g. 09XXXXXXXXX)",
      },
    ],
    hasSuccessState: true,
    successMessage: "Phone number is valid",
  },
  {
    id: "service-type",
    required: true,
    requiredMessage: "Select a service type.",
    rules: [],
    hasSuccessState: false,
  },
  {
    id: "appointment-date",
    required: true,
    requiredMessage: "Select an appointment date.",
    rules: [
      {
        test: (value) => new Date(value) >= new Date(new Date().toDateString()),
        message: "Date cannot be in the past.",
      },
    ],
    hasSuccessState: true,
    successMessage: "Appointment date is available",
  },
  {
    id: "time-slot",
    required: true,
    requiredMessage: "Select a time slot.",
    rules: [],
    hasSuccessState: true,
    successMessage: "Time slot is available",
  },
];

let hasAttemptedSubmit = false;

fieldConfigs.forEach((config) => {
    const input = document.getElementById(config.id);
    input.addEventListener('focus', () => {
        if (input.classList.contains('error')) {
            clearFieldError(config);
        }
    });
    input.addEventListener('blur', () => {
        const value = input.value.trim()
        if (!hasAttemptedSubmit && config.required && value === '') {
            return;
        }
        validateField(config);
    });
});

function setFieldSuccess(config) {
  const input = document.getElementById(config.id);
  const errorSpan = document.getElementById(`${config.id}-error`);
  const errorText = errorSpan.querySelector(".error-text");

  input.classList.remove("error");
  input.classList.add("success");
  input.setAttribute("aria-invalid", "false");
  errorSpan.classList.add("success");
  errorText.textContent = config.successMessage;
  errorSpan.hidden = false;

  return true;
}

function setFieldError(config, message) {
  const input = document.getElementById(config.id);
  const errorSpan = document.getElementById(`${config.id}-error`);
  const errorText = errorSpan.querySelector(".error-text");

  input.classList.remove("success");
  input.classList.add("error");
  input.setAttribute("aria-invalid", "true");
  errorSpan.classList.remove("success");
  errorText.textContent = message;
  errorSpan.hidden = false;

  return false;
}

function clearFieldError(config) {
  const input = document.getElementById(config.id);
  const errorSpan = document.getElementById(`${config.id}-error`);
  const errorText = errorSpan.querySelector(".error-text");

  input.classList.remove("error");
  input.removeAttribute('aria-invalid');
  errorSpan.classList.remove("success");
  errorText.textContent = "";
  errorSpan.hidden = true;
}

function validateField(config) {
  const input = document.getElementById(config.id);
  const value = input.value.trim();

  if (config.required && value === "") {
    return setFieldError(config, config.requiredMessage);
  }

  if (!config.required && value === "") {
    clearFieldError(config);
    return true;
  }

  for (const rule of config.rules) {
    if (!rule.test(value)) {
      return setFieldError(config, rule.message);
    }
  }

  if (config.hasSuccessState) {
    return setFieldSuccess(config);
  }

  clearFieldError(config);
  return true;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  hasAttemptedSubmit = true;

  const results = fieldConfigs.map(validateField);
  const isValid = results.every((result) => result === true);

  if (isValid) {
    console.log("Form is valid - ready to submit");
  }
});
