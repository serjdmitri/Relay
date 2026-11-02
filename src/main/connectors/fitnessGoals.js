function stepGoal(value){const goal=Number(value);if(!Number.isInteger(goal)||goal<100||goal>100000)throw Error('Choose a whole-number step goal from 100 to 100,000.');return goal;}
function stepProgress(steps,goal){goal=stepGoal(goal);if(!Number.isFinite(steps)||steps<0)return{goal,steps:null,percent:null,remaining:null,extra:null};return{goal,steps,percent:Math.min(100,Math.round(steps/goal*100)),remaining:Math.max(0,goal-steps),extra:Math.max(0,steps-goal)};}
module.exports={stepGoal,stepProgress};
