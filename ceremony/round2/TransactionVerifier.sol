// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract Groth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 4746909440197464430734407662441846826426438911067447996504354822205018742693;
    uint256 constant alphay  = 15539099343762776572245720328588598375060198411438250653523030751947072430392;
    uint256 constant betax1  = 7888152458842832559920636291634186352875074255019789449272657139231027460657;
    uint256 constant betax2  = 3263460527037737910677730841378321638867369036094318368908671358058235014570;
    uint256 constant betay1  = 2731430594051652596684165160482369944348252881412685640441373972613219478122;
    uint256 constant betay2  = 7980724191040175570889992343878491654546641712517548611602768855623669063181;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 11179787900141810321107428296699166123052604597653489069846296626613089149554;
    uint256 constant deltax2 = 18597335278890662934111444168715441431756522759264216139270194050914867398115;
    uint256 constant deltay1 = 8338292932119146902829390759669248013395456778010618033064883358668986620862;
    uint256 constant deltay2 = 6662447538004188931538751984258327239204013532683263803478818376331808669406;

    
    uint256 constant IC0x = 13054417797065183830070135434723638785503276188443733058410980630658011220427;
    uint256 constant IC0y = 21826339671654324474949966145807999756781302697808536129376441530411095973660;
    
    uint256 constant IC1x = 20469431671337977957187697005540507946632776204238281518042842324000496011882;
    uint256 constant IC1y = 21217155626680827627733341062936631951221479893659775966953408932202298586245;
    
    uint256 constant IC2x = 19478259059740921281516517939575816422806444681662912695932136891392519003662;
    uint256 constant IC2y = 10447604980261196647192483342413361176316195602550576566956757062847603933398;
    
    uint256 constant IC3x = 13679259347556227932943367080170776415168417351857437856731926484001594756075;
    uint256 constant IC3y = 9378753770751050613664415349579108673135678830496752422648974526229284961504;
    
    uint256 constant IC4x = 14031947100976012598509784120774721929423534019486741423636566715100649500282;
    uint256 constant IC4y = 15112158550108366684457744275192419060765934405479880129081673742461461825738;
    
    uint256 constant IC5x = 12644285862403409264167125228593763978698277808005301200701736745066091416526;
    uint256 constant IC5y = 8314869027556319567607535388052185017215705780091211658852024469218635551065;
    
    uint256 constant IC6x = 14428887401311474881784005486666933299206778223533204740362020495157442979355;
    uint256 constant IC6y = 16173881500185568149759004394518550363049707021811522779963781753029744668133;
    
    uint256 constant IC7x = 3040387608205764718396803953412086959345865413938820563133534069772999081405;
    uint256 constant IC7y = 20622525995916351261536137477435190257394278549203092181462191997518363958897;
    
    uint256 constant IC8x = 9672345939580532509085990286499784888802056738573072716598396849704024385839;
    uint256 constant IC8y = 10541754417029470055368611938181339752893480210543284743834159390478800700700;
    
    uint256 constant IC9x = 20889329854158016279346468801746564032188627818374051682436396079572381120679;
    uint256 constant IC9y = 2380724315782749458525590137835234508846971876810905043516919221300480614080;
    
    uint256 constant IC10x = 15781336054814572934184946445007855585853109131556286113839314451913039714790;
    uint256 constant IC10y = 6959982014913455059947026503320480356380210255224273773646168478880279035239;
    
    uint256 constant IC11x = 120080262196596201398883347452210602117522955931806074629271090013007234307;
    uint256 constant IC11y = 1737619049844475158063101552316332610022469823450994852547474867160943068490;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[11] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
