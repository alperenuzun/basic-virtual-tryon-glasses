import React, { Component } from 'react';
import { TryOn } from './TryOn'

export default class App extends Component {

  render() {
    return (
      <div className="App">
        <TryOn onReady={this.ready}/>
      </div>

    );
  }
  
}
