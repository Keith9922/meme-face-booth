import React from 'react';
import ReactDOM from 'react-dom/client';

// 组件库样式必须在自己的样式之前引入，后面才好覆盖
import 'animal-island-ui/style';
import './styles/global.css';

import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
