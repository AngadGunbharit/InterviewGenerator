import React, { useState } from 'react';
import './style.css';

function RadioButtonGroup() {
  const [selectedOption, setSelectedOption] = useState('');
  
  // Define your radio button options here
  const radioOptions = [
    { id: 'option1', label: 'Existing Customer' },
    { id: 'option2', label: 'New Customer' },
    { id: 'option3', label: 'Guest' },
  ];

  const handleOptionChange = (event) => {
    setSelectedOption(event.target.value);
  };

  return (
    <div className="radio-button-group">
      {radioOptions.map(option => (
        <label key={option.id}>
          <input
            type="radio"
            value={option.id}
            checked={selectedOption === option.id}
            onChange={handleOptionChange}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

function App() {
  return (
    <div className="App">
      <h1>Type of Customer:</h1>
      <RadioButtonGroup />
    </div>
  );
}

export default App;
