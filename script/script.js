// Regex pattern for the proper format of name, email, phone number
const NAME_MIN_LENGTH = 2;
const NAME_PATTERN = /^[A-Za-z\s'-]+$/;
const EMAIL_PATTERN =
  /^[a-zA-Z0-9_+-]+(\.[a-zA-Z0-9_+-]+)*@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;
const PH_MOBILE_PATTERN = /^(09|\+639)\d{9}$/;

// Select the booking form element 
const form = document.getElementById("booking-form");
const submitButton = document.querySelector('[type="submit"]');

// Array of field configuration objects with relevant keys:
// ID of the field element
// If field is required or optional
// Required message if required
// Rules array of objects with properties of validation rules and message if validation failed
// If field needs a success state
// Success message if field has success state
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

// Check if user has already attempted to submit the form
let hasAttemptedSubmit = false;

// Loop through each field config
fieldConfigs.forEach((config) => {
  // Select the input based on the id of the current config
    const input = document.getElementById(config.id);

    // Add input event listener to selected input and run updateSubmitButton function for every input
    input.addEventListener('input', updateSubmitButton);

    // Add focus event listener to the selected input
    input.addEventListener('focus', () => {
      // On input focus, check if input contains error class
        if (input.classList.contains('error')) {
          // If yes, run the clearFieldError function
            clearFieldError(config);
        } // If not, do nothing, so that success class (success states) will not disappear on focus
    });

    // Add blur event listener to the selected input
    input.addEventListener('blur', () => {
      // Get the value of the current input
        const value = input.value.trim()

        // On blur, check if hasAttemptedSubmit is false, and if field is required, and the value is empty
        if (!hasAttemptedSubmit && config.required && value === '') {
          // If yes, return, do nothing, this is to avoid triggering error state every time a user leaves a required field blank
            return;
        }
        // If not the case, validate the field on blur
        validateField(config);
    });
});

// Function to set a field successful upon validation
function setFieldSuccess(config) {
  // Select the input element, the errorSpan element, and the errorText
  const input = document.getElementById(config.id);
  const errorSpan = document.getElementById(`${config.id}-error`);
  const errorText = errorSpan.querySelector(".error-text");

  // Remove the error class from input, in case present
  input.classList.remove("error");

  // Add the success class to the input
  input.classList.add("success");

  // Set aria-invalid of input to false
  input.setAttribute("aria-invalid", "false");

  // Add the success class to the error span element
  errorSpan.classList.add("success");

  // Update the textContent of errorText to the successMessage of the current field
  errorText.textContent = config.successMessage;

  // Set hidden attribute of errorSpan to false to show the success state
  errorSpan.hidden = false;

  // Return true - successful validation
  return true;
}

// Function to set a field error upon validation
function setFieldError(config, message) {
  // Select the input element, the errorSpan element, and the errorText
  const input = document.getElementById(config.id);
  const errorSpan = document.getElementById(`${config.id}-error`);
  const errorText = errorSpan.querySelector(".error-text");

  // Remove the success class from input, in case present
  input.classList.remove("success");

  // Add the error class to the input
  input.classList.add("error");

  // Set the aria-invalid attribute to true of input
  input.setAttribute("aria-invalid", "true");

  // Remove the success class from the errorSpan element
  errorSpan.classList.remove("success");

  // Update the textContent of the errorText to show the error message
  errorText.textContent = message;

  // Set hidden attribute of errorSpan to false to show the error state
  errorSpan.hidden = false;

  // Return false - failed validation
  return false;
}

// Function to clear the field error state
function clearFieldError(config) {
  // Select the input element, the errorSpan element, and the errorText
  const input = document.getElementById(config.id);
  const errorSpan = document.getElementById(`${config.id}-error`);
  const errorText = errorSpan.querySelector(".error-text");

  // Remove the error class from input
  input.classList.remove("error");

  // Remove the success class from input
  input.classList.remove("success");

  // Remove the aria-invalid attribute from input
  input.removeAttribute('aria-invalid');

  // Remove the success class from input
  errorSpan.classList.remove("success");

  // Set the textContent of errorText to blank
  errorText.textContent = "";

  // Set the hidden attribute of the errorSpan to true to hide the validation state
  errorSpan.hidden = true;
}

// Function to check field validity
function checkFieldValidity(config) {
  // Get the input element using config.id
  const input = document.getElementById(config.id);
  // Get the value of the input element
  const value = input.value.trim();

  // Check if input is required and the value is empty
  if (config.required && value === "") {
    // Return object with keys valid set to false and message set to config.requiredMessage
    return { valid: false, message: config.requiredMessage };
  }
  // Check if input is not required and value is empty
  if (!config.required && value === "") {
    // Return object with keys valid set to true and message set to null
    return { valid: true, message: null };
  }
  // Loop through the config.rules
  for (const rule of config.rules) {
    // Check if any rule fails
    if (!rule.test(value)) {
      // If yes return object with keys valid set to false and message set to rule.message
      return { valid: false, message: rule.message };
    }
  }

  // If no fails, return object with keys valid set to true and message set to null
  return { valid: true, message: null };
}

// Function to validate the field
function validateField(config) {
  // Get the valid and message keys from result of checkFieldValidity
  const { valid, message } = checkFieldValidity(config);

  // Check if valid is false
  if (!valid) {
    // If yes, return setFieldError
    return setFieldError(config, message);
  }

  // Check if field config has a successState
  if (config.hasSuccessState) {
    // If yes, return setFieldSuccess
    return setFieldSuccess(config);
  }

  // After all checks, if no errors, and no need for success state, clear the field error and return true - validation successful
  clearFieldError(config);
  return true;
}

// Function to check if field is valid
function isFieldValid(config) {
  // Returns the valid key from the result of running checkFieldValidity
  return checkFieldValidity(config).valid;
}

// Function to update the submit button
function updateSubmitButton() {
  // Declare allValid variable that will be set to either true or false depending on if every field is valid
  const allValid = fieldConfigs.every(isFieldValid);
  // Set the disabled attribute of submit button to false if allValid is true (vice versa)
  submitButton.disabled = !allValid;
}

// Add submit event listener to form
form.addEventListener("submit", (e) => {
  // Prevent form from submitting
  e.preventDefault();

  // Set the hasAttemptedSubmit to true
  hasAttemptedSubmit = true;

  // Loop through the fieldConfigs array and run validateField on each field config and store the resulting array to results var
  const results = fieldConfigs.map(validateField);

  // Loop through the results array and check if all the values of result is true, and store it in isValid var
  const isValid = results.every((result) => result === true);

  // Check is isValid is true or not
  if (isValid) {
    // Log the result
    console.log("Form is valid - ready to submit");
  }
});

updateSubmitButton();
