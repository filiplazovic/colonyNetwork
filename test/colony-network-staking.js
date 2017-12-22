/* globals artifacts ColonyNetwork, Colony, IColony, Resolver */
import sha3 from 'solidity-sha3';
import testHelper from '../helpers/test-helper';
const upgradableContracts = require('../helpers/upgradable-contracts');

const EtherRouter = artifacts.require('EtherRouter');
const Colony = artifacts.require('Colony');
const ColonyFunding = artifacts.require('ColonyFunding');
const ColonyTask= artifacts.require('ColonyTask');
const ColonyTransactionReviewer= artifacts.require('ColonyTransactionReviewer');
const IColony = artifacts.require('IColony');
const IColonyNetwork = artifacts.require('IColonyNetwork');
const Resolver = artifacts.require('Resolver');
const Token = artifacts.require('Token');
const ReputationMiningCycle = artifacts.require('ReputationMiningCycle');

const BigNumber = require('bignumber.js')

const specificationHash = '9bb76d8e6c89b524d34a454b3140df28';


contract('ColonyNetwork', function (accounts) {
  const COLONY_KEY = 'COLONY_TEST';
  const MAIN_ACCOUNT = accounts[0];
  const OTHER_ACCOUNT = accounts[1];
  const GAS_TO_SPEND = 4700000;
  let colony;

  var x = 1;

  let commonColony;
  let colonyFunding;
  let colonyTransactionReviewer;
  let colonyTask;
  let resolver;
  let resolverColonyNetworkDeployed;
  let colonyNetwork;
  let createColonyGas;
  let version;
  let clny;

  before(async function () {
    const network = await testHelper.web3GetNetwork();
    createColonyGas = (network == 'coverage') ? '0xfffffffffff' : 4e6;

    const etherRouter = await EtherRouter.deployed();
    colonyNetwork = await IColonyNetwork.at(etherRouter.address);
    // await upgradableContracts.setupColonyVersionResolver(colony, colonyFunding, colonyTask, colonyTransactionReviewer, resolver, colonyNetwork);

    let commonColonyAddress = await colonyNetwork.getColony("Common Colony");
    commonColony  = IColony.at(commonColonyAddress);
    console.log('CC address ', commonColonyAddress);
    let clnyAddress = await commonColony.getToken.call();
    console.log('CLNY address ', clnyAddress);
    clny = Token.at(clnyAddress);
  });

  async function giveUserCLNYTokens(address, amount){
    let mainStartingBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    let targetStartingBalance = await clny.balanceOf.call(address);
    await commonColony.makeTask(specificationHash);
    let taskCount = await commonColony.getTaskCount.call();
    await commonColony.setTaskRoleUser(taskCount, 2, MAIN_ACCOUNT);
    await commonColony.mintTokens(amount*1.2);
    await commonColony.claimColonyFunds(clny.address);
    let potBalance = await commonColony.getPotBalance(1, clny.address);
    const txData = await commonColony.contract.setTaskPayout.getData(taskCount, 0, clny.address, amount*1.1);
    await commonColony.proposeTaskChange(txData, 0, 0, {from: MAIN_ACCOUNT});
    let txCount = await commonColony.getTransactionCount.call();
    await commonColony.approveTaskChange(txCount, 2, { from: MAIN_ACCOUNT });
    await commonColony.moveFundsBetweenPots(1,taskCount.add(1),amount*1.1,clny.address, {from:MAIN_ACCOUNT});
    await commonColony.acceptTask(taskCount);
    await commonColony.claimPayout(taskCount, 0, clny.address);

    let mainBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    clny.transfer(0x0, mainBalance.minus(amount).minus(mainStartingBalance));
    await clny.transfer(address, amount);

    mainBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    if (address != MAIN_ACCOUNT){
      await clny.transfer(0x0, mainBalance.minus(mainStartingBalance));
    }

    let userBalance = await clny.balanceOf.call(address);
    assert.equal(targetStartingBalance.add(amount).toNumber(), userBalance.toNumber());
  }

  afterEach(async function () {
    let stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
    if (stakedBalance.toNumber() > 0){
      await colonyNetwork.withdraw(stakedBalance.toNumber(), {from: OTHER_ACCOUNT});
    }
    stakedBalance = await colonyNetwork.getStakedBalance.call(MAIN_ACCOUNT);
    if (stakedBalance.toNumber() > 0){
      await colonyNetwork.withdraw(stakedBalance.toNumber(), {from: MAIN_ACCOUNT});
    }
    let userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
    clny.transfer(0x0, userBalance, {from: OTHER_ACCOUNT});
    userBalance = await clny.balanceOf.call(MAIN_ACCOUNT);
    clny.transfer(0x0, userBalance, {from: MAIN_ACCOUNT});
  });

  describe('when initialised', () => {
    it('should allow miners to stake CLNY', async function () {
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 5000, { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(5000, {from: OTHER_ACCOUNT});
      let userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
      assert.equal(userBalance.toNumber(), 4000);
      let stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 5000);
    });

    it('should allow miners to withdraw staked CLNY', async function (){
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 5000, { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(5000, {from: OTHER_ACCOUNT});
      let stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      await colonyNetwork.withdraw(stakedBalance.toNumber(), {from: OTHER_ACCOUNT});
      stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 0);
    });

    it('should not allow miners to deposit more CLNY than they have', async function(){
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 10000, { from: OTHER_ACCOUNT });
      await colonyNetwork.deposit(10000, {from: OTHER_ACCOUNT});
      let userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
      assert.equal(userBalance.toNumber(), 9000);
      let stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 0);
    });

    it('should not allow miners to withdraw more CLNY than they staked, even if enough has been staked total', async function(){
      await giveUserCLNYTokens(MAIN_ACCOUNT, 9000);
      await giveUserCLNYTokens(OTHER_ACCOUNT, 9000);
      await clny.approve(colonyNetwork.address, 9000, { from: OTHER_ACCOUNT });
      await clny.approve(colonyNetwork.address, 9000, { from: MAIN_ACCOUNT });
      await colonyNetwork.deposit(9000, {from: OTHER_ACCOUNT});
      await colonyNetwork.deposit(9000, {from: MAIN_ACCOUNT});
      await colonyNetwork.withdraw(10000, {from: OTHER_ACCOUNT});
      let stakedBalance = await colonyNetwork.getStakedBalance.call(OTHER_ACCOUNT);
      assert.equal(stakedBalance.toNumber(), 9000);
      let userBalance = await clny.balanceOf.call(OTHER_ACCOUNT);
      assert.equal(userBalance.toNumber(), 0);
    });

    it('should allow a new cycle to start if there is none currently', async function(){
      let addr = await colonyNetwork.getReputationMiningCycle.call();
      assert(addr==0x0);
      await colonyNetwork.startNextCycle();
      addr = await colonyNetwork.getReputationMiningCycle.call();
      assert(addr!=0x0);
    })

    it.only('should allow a new reputation hash to be submitted', async function(){
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber("1000000000000000000"));
      await clny.approve(colonyNetwork.address, new BigNumber("1000000000000000000"));
      await colonyNetwork.deposit(new BigNumber("1000000000000000000"));

      let addr = await colonyNetwork.getReputationMiningCycle.call();
      if (addr == 0x0){
        await colonyNetwork.startNextCycle();
        addr = await colonyNetwork.getReputationMiningCycle.call();
      }
      console.log(addr);
      await testHelper.forwardTime(3600);
      let repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash("0x12345678",10,10);
      let submitterAddress = await repCycle.submittedHashes.call("0x12345678",10,0);
      assert.equal(submitterAddress, MAIN_ACCOUNT);
    });

    it('should not allow someone to submit a new reputation hash if they are not staking', async function(){
      let addr = await colonyNetwork.getReputationMiningCycle.call();
      if (addr == 0x0){
        await colonyNetwork.startNextCycle();
        addr = await colonyNetwork.getReputationMiningCycle.call();
      }
      await testHelper.forwardTime(3600);
      let repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash("0x12345678",10,10);
      let submitterAddress = await repCycle.submittedHashes.call("0x12345678",10,0);
      assert.equal(submitterAddress, MAIN_ACCOUNT);
    });

    it('should not allow someone to withdraw their stake if they have submitted a hash this round', async function(){
      await giveUserCLNYTokens(MAIN_ACCOUNT, new BigNumber("1000000000000000000"));
      await clny.approve(colonyNetwork.address, new BigNumber("1000000000000000000"));
      await colonyNetwork.deposit(new BigNumber("1000000000000000000"));

      let addr = await colonyNetwork.getReputationMiningCycle.call();
      if (addr == 0x0){
        await colonyNetwork.startNextCycle();
        addr = await colonyNetwork.getReputationMiningCycle.call();
      }
      await testHelper.forwardTime(3600);
      let repCycle = ReputationMiningCycle.at(addr);
      await repCycle.submitNewHash("0x12345678",10,10);
      let stakedBalance = await colonyNetwork.getStakedBalance.call(MAIN_ACCOUNT);
      await colonyNetwork.withdraw(stakedBalance.toNumber(), {from: MAIN_ACCOUNT});
      stakedBalance = await colonyNetwork.getStakedBalance.call(MAIN_ACCOUNT);
      assert(stakedBalance.equals("1000000000000000000"));

    })
    it('should allow a new reputation hash to be set if only one was submitted');
    it('should not allow a new reputation hash to be set if more than one was submitted and they have not been elimintated')
    it('should allow a new reputation hash to be set if more than one was submitted and all but one have been elimintated')
    it('should not allow the last reputation hash to be eliminated')
    it('should not allow someone to submit a new reputation hash if they are ineligible')
    it('should not allow a new reputation hash to be set if two or more were submitted')
    it('should punish stakers if they misbehave')
    it('should reward stakers if they submitted the agreed new hash')
  });
});
