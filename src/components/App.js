import React, { Component } from 'react';
import { FaceFilter } from './FaceFilter'

export default class App extends Component {

  render() {
    return (
      <div className="App">
        <FaceFilter  onReady={this.ready}/>
      </div>

    );
  }
  
}
